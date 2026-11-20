// SPDX-License-Identifier: AGPL-3.0-or-later
// reports (Przemo's report.php): ?p=ID reports a post; ?mode=queue is the moderators' queue.
// The store and the rules about who sees what are in @postmodem/modules (reports.ts).

import { defaultLocale, systemMessage } from "@postmodem/core";
import { negotiate, translator } from "@postmodem/i18n";
import { excerpt } from "@postmodem/markup";
import { REPORT_REASON_MAX, REPORTS_CHANNEL, reportsFor, reportsStore } from "@postmodem/modules";
import { error, fail, redirect } from "@sveltejs/kit";
import { topicRef } from "#lib/server/board.ts";
import { afterMessage, live } from "#lib/server/notifications.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

function guard({ locals, url }: Pick<RequestEvent, "locals" | "url">) {
  if (!locals.ctx.packages.isEnabled("reports")) error(404, "Not found");
  if (!locals.user) redirect(303, `/login.php?redirect=${encodeURIComponent(url.pathname + url.search)}`);
  return { user: locals.user, store: reportsStore(locals.ctx.db.kysely.withoutPlugins()) };
}

/** The post being reported, if the member may report it (not their own, readable forum). */
async function reportable({ locals, url }: Pick<RequestEvent, "locals" | "url">, userId: number) {
  const { repos } = locals.ctx.db;
  const post = await repos.posts.get(Number(url.searchParams.get("p")) || 0);
  const topic = post?.visibility === "core:public" ? await repos.topics.get(post.topicId) : undefined;
  const node = topic?.visibility === "core:public" ? await repos.nodes.get(topic.nodeId) : undefined;
  if (!post || !topic || !node || !locals.perms.can("node.read", node)) error(404, "Not found");
  if (post.authorId === userId || !locals.perms.can("reports.create", node)) error(403, "Forbidden");
  return { post, topic };
}

export const load: PageServerLoad = async (event) => {
  const { user, store } = guard(event);
  const { repos } = event.locals.ctx.db;
  if (event.url.searchParams.get("mode") === "queue") {
    const open = await reportsFor(store, repos, event.locals.perms);
    if (
      !open.length &&
      ![...(await repos.nodes.tree())].some((n) => event.locals.perms.can("moderate.reports", n))
    )
      error(403, "Forbidden");
    const people = await repos.users.getMany(
      open.flatMap((o) => [o.report.reporterId, ...(o.post.authorId ? [o.post.authorId] : [])]),
    );
    const topics = await repos.topics.getMany(open.map((o) => o.post.topicId));
    return {
      mode: "queue" as const,
      reports: open.map(({ report, post, node }) => ({
        id: report.id,
        reason: report.reason,
        at: report.createdAt,
        reporter: people.get(report.reporterId)?.username ?? "",
        postId: post.id,
        author: (post.authorId && people.get(post.authorId)?.username) || post.authorName,
        excerpt: excerpt(post.source, 200),
        forum: node.title,
        topic: topics.get(post.topicId)
          ? { ...topicRef(topics.get(post.topicId)!), title: topics.get(post.topicId)!.title }
          : null,
      })),
    };
  }
  const { post, topic } = await reportable(event, user.id);
  return {
    mode: "report" as const,
    already: !!(await store.openBy(post.id, user.id)),
    post: { id: post.id, excerpt: excerpt(post.source, 300) },
    topic: { ...topicRef(topic), title: topic.title },
  };
};

export const actions: Actions = {
  report: async (event) => {
    const { user } = guard(event);
    const { post } = await reportable(event, user.id);
    const form = await event.request.formData();
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason || [...reason].length > REPORT_REASON_MAX) return fail(400, { error: "reason", reason });
    // Reports count as posts for the volume throttle: one report per post per member anyway.
    const key = String(user.id);
    const now = Date.now();
    if ((await event.locals.ctx.throttles.posting.wait(key, now)) > 0)
      return fail(429, { error: "reason", reason });
    const created = await event.locals.ctx.db.repos.transaction(async (tx) => {
      const account = await tx.users.get(user.id, { forUpdate: true });
      if (account?.status !== "active") error(403, "Forbidden");
      const store = reportsStore(tx.raw);
      if (await store.openBy(post.id, user.id)) return false;
      await store.create({ postId: post.id, reporterId: user.id, reason, now });
      return true;
    });
    if (created) {
      await live(event.locals.ctx, REPORTS_CHANNEL, null, "changed");
      await event.locals.ctx.throttles.posting.fail(key, now);
      event.locals.ctx.log.info("post reported", { postId: post.id, by: user.id });
    }
    return { sent: true };
  },
  close: async (event) => {
    const { user, store } = guard(event);
    const form = await event.request.formData();
    const report = await store.get(Number(form.get("id")) || 0);
    if (!report || report.status !== "open") error(404, "Not found");
    const post = await event.locals.ctx.db.repos.posts.get(report.postId);
    const node = post && (await event.locals.ctx.db.repos.nodes.get(post.nodeId));
    // A report about a post that's gone can be closed by any moderator who sees the queue.
    if (node && !event.locals.perms.can("moderate.reports", node)) error(403, "Forbidden");
    const outcome = String(form.get("outcome") ?? "")
      .trim()
      .slice(0, 500);
    await store.close(report.id, user.id, outcome);
    await live(event.locals.ctx, REPORTS_CHANNEL, null, "changed");
    // Tell the reporter, in their language, by private message from the moderator.
    const reporter = await event.locals.ctx.db.repos.users.get(report.reporterId);
    if (reporter && reporter.status === "active") {
      const tr = translator(
        negotiate({
          requested: reporter.locale ?? undefined,
          boardDefault: event.locals.ctx.settings.get(defaultLocale),
        }),
      );
      const link = new URL(event.locals.urls.post(report.postId), event.locals.ctx.config.publicUrl).href;
      const message = await systemMessage(event.locals.ctx.db.repos, {
        senderId: user.id,
        recipientId: reporter.id,
        subject: tr("reports-closed-subject"),
        source: tr("reports-closed-body", { link, outcome: outcome ? `\n\n${outcome}` : "" }),
      });
      await afterMessage(event.locals.ctx, message, reporter, user);
    }
    await event.locals.ctx.db.repos.audit.append({
      actorId: user.id,
      action: "reports.closed",
      targetType: "post",
      targetId: String(report.postId),
      details: { report: report.id, outcome },
    });
    return { closed: report.id };
  },
};
