// SPDX-License-Identifier: AGPL-3.0-or-later
// /email/ID: e-mail a member through the board (#132), phpBB2's profile.php?mode=email&u=ID.
// The board relays the message: the recipient doesn't see the sender's address, the sender
// never sees the recipient's, and replies go by private message.
import { boardName, memberEmail, memberMailProblem, newMemberPosts, reachableByMail } from "@postmodem/core";
import { translator } from "@postmodem/i18n";
import { error, fail, redirect } from "@sveltejs/kit";
import { linkTo, localeOf } from "#lib/server/notifications.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

async function recipientOf({ params, locals, url }: Pick<RequestEvent, "params" | "locals" | "url">) {
  if (!locals.user) redirect(303, `/login.php?redirect=${encodeURIComponent(url.pathname)}`);
  const recipient = await locals.ctx.db.repos.users.get(Number(params.id) || 0);
  // Members who don't take e-mail look the same as missing ones: nothing is revealed.
  if (
    !recipient ||
    !reachableByMail(recipient, locals.ctx.settings.get(memberEmail)) ||
    recipient.id === locals.user.id
  )
    error(404, "Not found");
  return recipient;
}

export const load: PageServerLoad = async (event) => {
  const recipient = await recipientOf(event);
  return {
    recipient: { id: recipient.id, slug: recipient.slug, username: recipient.username },
    senderHasEmail: !!event.locals.user!.email,
  };
};

export const actions: Actions = {
  default: async (event) => {
    const recipient = await recipientOf(event);
    const { locals } = event;
    const sender = locals.user!;
    const { ctx } = locals;
    const form = await event.request.formData();
    const values = {
      subject: String(form.get("subject") ?? ""),
      body: String(form.get("message") ?? ""),
      copy: form.get("copy") === "on",
    };
    const checked = memberMailProblem(sender, recipient, locals.perms, values, {
      boardAllows: ctx.settings.get(memberEmail),
      newMemberPosts: ctx.settings.get(newMemberPosts),
    });
    if (typeof checked === "string") return fail(400, { problem: checked, values });
    const now = Date.now();
    const key = String(sender.id);
    if ((await ctx.throttles.memberMail.wait(key, now)) > 0)
      return fail(429, { problem: "throttled" as const, values });
    await ctx.throttles.memberMail.fail(key, now);

    const board = ctx.settings.get(boardName);
    const vars = {
      from: sender.username,
      to: recipient.username,
      board,
      subject: checked.subject,
      message: checked.body,
      reply: linkTo(ctx, `/privmsg.php?mode=post&u=${encodeURIComponent(sender.username)}`),
      profile: linkTo(ctx, locals.urls.user({ id: sender.id, slug: sender.slug })),
      account: linkTo(ctx, "/account"),
    };
    const forRecipient = translator(localeOf(ctx, recipient));
    await ctx.sendMail({
      to: recipient.email!,
      subject: forRecipient("mail-member-subject", vars),
      text: forRecipient("mail-member-body", vars),
      locale: localeOf(ctx, recipient),
    });
    if (values.copy && sender.email) {
      const forSender = translator(localeOf(ctx, sender));
      await ctx.sendMail({
        to: sender.email,
        subject: forSender("mail-member-copy-subject", vars),
        text: forSender("mail-member-copy-body", vars),
        locale: localeOf(ctx, sender),
      });
    }
    // Who wrote to whom is logged without the text, as for any other mail the board sends.
    ctx.log.info("member e-mail sent", { from: sender.id, to: recipient.id });
    return { sent: true };
  },
};
