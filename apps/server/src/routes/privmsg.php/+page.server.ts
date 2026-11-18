// SPDX-License-Identifier: AGPL-3.0-or-later
// /privmsg.php — phpBB2's private messages (M2 slice 5):
//   ?folder=inbox|sent        the folders (25 a page, ?start= like phpBB2)
//   ?mode=read&p=ID           one message (marks it read)
//   ?mode=post[&u=NAME][&reply=ID]   write one; a reply quotes the message
// Rules in @postmodem/core (messaging.ts); posting limits count messages too.
import {
  boardName,
  inboxLimit,
  type MessageProblem,
  maxPostLength,
  newMemberPosts,
  openMessage,
  sendMessage,
} from "@postmodem/core";
import { error, fail, redirect } from "@sveltejs/kit";
import { normaliseStart } from "#lib/pagination.ts";
import { afterMessage } from "#lib/server/notifications.ts";
import { quoteSource } from "#lib/server/posting.ts";
import { readerOf } from "#lib/server/reader.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

const PER_PAGE = 25;

function signedIn({ locals, url }: Pick<RequestEvent, "locals" | "url">) {
  if (!locals.user) redirect(303, `/login.php?redirect=${encodeURIComponent(url.pathname + url.search)}`);
  return locals.user;
}

export const load: PageServerLoad = async (event) => {
  const user = signedIn(event);
  const { url, locals } = event;
  const { repos } = locals.ctx.db;
  const mode = url.searchParams.get("mode");
  const names = async (ids: (number | null)[]) => {
    const people = await repos.users.getMany(ids.filter((i): i is number => i !== null));
    return (id: number | null) =>
      id === null ? locals.ctx.settings.get(boardName) : (people.get(id)?.username ?? "?");
  };

  if (mode === "read") {
    const m = await openMessage(repos, user, Number(url.searchParams.get("p")) || 0);
    if (!m) error(404, "Not found");
    const name = await names([m.senderId, m.recipientId]);
    return {
      mode: "read" as const,
      message: {
        id: m.id,
        subject: m.subject,
        from: name(m.senderId),
        to: name(m.recipientId),
        at: m.createdAt,
        incoming: m.recipientId === user.id,
        canReply: m.recipientId === user.id && m.senderId !== null,
        html: await locals.ctx.renderer.preview(m.source, readerOf(locals)),
      },
    };
  }

  if (mode === "post") {
    let values = { to: url.searchParams.get("u") ?? "", subject: "", source: "" };
    const replyTo = Number(url.searchParams.get("reply")) || 0;
    if (replyTo) {
      const m = await openMessage(repos, user, replyTo);
      if (!m || m.recipientId !== user.id || m.senderId === null) error(404, "Not found");
      const from = (await repos.users.get(m.senderId))?.username ?? "";
      values = {
        to: from,
        subject: m.subject.startsWith("Re: ") ? m.subject : `Re: ${m.subject}`,
        source: quoteSource(from, m.source),
      };
    }
    if (!locals.perms.can("pm.send", null)) error(403, "Forbidden");
    return { mode: "post" as const, values, maxLength: locals.ctx.settings.get(maxPostLength) };
  }

  const folder = url.searchParams.get("folder") === "sent" ? "sent" : "inbox";
  const start = normaliseStart(url.searchParams.get("start"), PER_PAGE, Number.MAX_SAFE_INTEGER);
  const page = await repos.messages[folder](user.id, { page: start / PER_PAGE + 1, perPage: PER_PAGE });
  const name = await names(page.items.flatMap((m) => [m.senderId, m.recipientId]));
  return {
    mode: "folder" as const,
    folder,
    start,
    perPage: PER_PAGE,
    total: page.total,
    messages: page.items.map((m) => ({
      id: m.id,
      subject: m.subject,
      other: folder === "inbox" ? name(m.senderId) : name(m.recipientId),
      at: m.createdAt,
      unread: m.readAt === null,
    })),
  };
};

const STATUS: Record<MessageProblem, number> = {
  "sign-in": 401,
  forbidden: 403,
  "recipient-unknown": 400,
  "inbox-full": 409,
  "subject-missing": 400,
  "subject-long": 400,
  "body-missing": 400,
  "body-long": 400,
  "new-member": 403,
};

export const actions: Actions = {
  send: async (event) => {
    const user = signedIn(event);
    const { locals } = event;
    const { ctx } = locals;
    const form = await event.request.formData();
    const values = {
      to: String(form.get("to") ?? "").slice(0, 100),
      subject: String(form.get("subject") ?? ""),
      source: String(form.get("source") ?? "").replace(/\r\n/g, "\n"),
    };
    if (form.get("intent") === "preview")
      return { values, preview: await ctx.renderer.preview(values.source, readerOf(locals)) };
    const now = Date.now();
    const key = String(user.id);
    const wait = await ctx.throttles.posting.wait(key, now);
    if (wait > 0) return fail(429, { values, problem: "flood", waitSeconds: Math.ceil(wait / 1000) });
    const result = await sendMessage(ctx.db.repos, locals.perms, user, values, {
      maxLength: ctx.settings.get(maxPostLength),
      inboxLimit: ctx.settings.get(inboxLimit),
      newMemberPosts: ctx.settings.get(newMemberPosts),
      now,
    });
    if (!result.ok) return fail(STATUS[result.problem], { values, problem: result.problem, waitSeconds: 0 });
    await ctx.throttles.posting.fail(key, now);
    await afterMessage(ctx, result.message, result.recipient, user);
    ctx.log.info("private message sent", { messageId: result.message.id, from: user.id });
    redirect(303, "/privmsg.php?folder=sent&sent=1");
  },
  delete: async (event) => {
    const user = signedIn(event);
    const form = await event.request.formData();
    const id = Number(form.get("id")) || 0;
    await event.locals.ctx.db.repos.messages.deleteFor(id, user.id);
    redirect(303, `/privmsg.php?folder=${form.get("folder") === "sent" ? "sent" : "inbox"}`);
  },
};
