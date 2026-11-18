// SPDX-License-Identifier: AGPL-3.0-or-later
// /modcp.php?t=ID — phpBB2's moderator control panel for one topic (M2 slice 2): lock,
// topic type, move, merge, split, delete. The rules and the audit log are in
// @postmodem/core (moderation.ts); every form carries a reason.
import {
  deleteTopic,
  lockTopic,
  type ModerationProblem,
  type ModerationResult,
  mergeTopics,
  moderates,
  moveTopic,
  setTopicType,
  splitTopic,
  type TopicType,
} from "@postmodem/core";
import { excerpt } from "@postmodem/markup";
import { error, fail, redirect } from "@sveltejs/kit";
import { nodeRef, topicRef } from "#lib/server/board.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

const id = (v: unknown) => {
  const s = String(v ?? "").trim();
  // A topic number, or any link to it (?t=123, /t/123-title).
  const m = /^(\d{1,15})$/.exec(s) ?? /[?&]t=(\d{1,15})/.exec(s) ?? /\/t\/(\d{1,15})/.exec(s);
  return m ? Number(m[1]) : null;
};

async function context({ url, locals }: Pick<RequestEvent, "url" | "locals">) {
  if (!locals.user) redirect(303, `/login.php?redirect=${encodeURIComponent(url.pathname + url.search)}`);
  const { repos } = locals.ctx.db;
  const topic = await repos.topics.get(id(url.searchParams.get("t")) ?? 0);
  const node =
    topic && topic.visibility === "core:public" && !topic.movedToTopicId
      ? await repos.nodes.get(topic.nodeId)
      : undefined;
  if (!topic || !node || !locals.perms.can("node.read", node)) error(404, "Not found");
  if (!moderates(locals.perms, node)) error(403, "Forbidden");
  return { topic, node };
}

export const load: PageServerLoad = async (event) => {
  const { topic, node } = await context(event);
  const { repos } = event.locals.ctx.db;
  const perms = event.locals.perms;
  const posts = (await repos.posts.allInTopic(topic.id)).filter((p) => p.visibility === "core:public");
  const users = await repos.users.getMany(posts.flatMap((p) => (p.authorId ? [p.authorId] : [])));
  const forums = (await repos.nodes.tree()).filter((n) => n.kind === "forum" && perms.can("node.read", n));
  return {
    topic: { ...topicRef(topic), title: topic.title, type: topic.type, locked: topic.locked },
    forum: { ...nodeRef(node), title: node.title },
    can: {
      lock: perms.can("moderate.lock", node),
      move: perms.can("moderate.move", node),
      split: perms.can("moderate.split", node),
      delete: perms.can("moderate.delete", node),
      sticky: perms.can("topic.sticky", node),
      announce: perms.can("topic.announce", node),
    },
    forums: forums.map((n) => ({
      id: n.id,
      title: `${"— ".repeat(n.depth)}${n.title}`,
      current: n.id === node.id,
    })),
    // The split list: capped, like phpBB2's, so a huge topic doesn't make a huge form.
    posts: posts.slice(0, 500).map((p, i) => ({
      id: p.id,
      first: i === 0,
      author: (p.authorId && users.get(p.authorId)?.username) || p.authorName,
      at: p.createdAt,
      text: excerpt(p.source, 120),
    })),
  };
};

const STATUS: Record<ModerationProblem, number> = {
  forbidden: 403,
  "not-found": 404,
  "same-forum": 400,
  "title-missing": 400,
  "title-long": 400,
  "nothing-selected": 400,
  invalid: 400,
};

/** Runs one moderation action and goes back to the topic (or the forum, after a delete). */
async function run(
  event: RequestEvent,
  fn: (form: FormData, reason: string) => Promise<ModerationResult>,
  toForum = false,
) {
  const { topic, node } = await context(event);
  const form = await event.request.formData();
  const reason = String(form.get("reason") ?? "")
    .slice(0, 500)
    .trim();
  const result = await fn(form, reason);
  if (!result.ok)
    return fail(STATUS[result.problem], {
      problem: result.problem,
      action: String(form.get("action") ?? ""),
    });
  event.locals.ctx.log.info("moderation", { topicId: topic.id, by: event.locals.user!.id });
  redirect(
    303,
    toForum ? event.locals.urls.forum(nodeRef(node)) : event.locals.urls.topic(topicRef(result.topic)),
  );
}

export const actions: Actions = {
  lock: (e) =>
    run(e, async (form, reason) => {
      const { topic } = await context(e);
      return lockTopic(
        e.locals.ctx.db.repos,
        e.locals.perms,
        e.locals.user!,
        topic.id,
        form.get("locked") === "1",
        reason,
      );
    }),
  type: (e) =>
    run(e, async (form, reason) => {
      const { topic } = await context(e);
      return setTopicType(
        e.locals.ctx.db.repos,
        e.locals.perms,
        e.locals.user!,
        topic.id,
        String(form.get("type")) as TopicType,
        reason,
      );
    }),
  move: (e) =>
    run(e, async (form, reason) => {
      const { topic } = await context(e);
      return moveTopic(
        e.locals.ctx.db.repos,
        e.locals.perms,
        e.locals.user!,
        topic.id,
        Number(form.get("forum")),
        {
          shadow: form.get("shadow") === "on",
          reason,
        },
      );
    }),
  merge: (e) =>
    run(e, async (form, reason) => {
      const { topic } = await context(e);
      const target = id(form.get("target"));
      if (!target) return { ok: false, problem: "invalid" };
      return mergeTopics(e.locals.ctx.db.repos, e.locals.perms, e.locals.user!, topic.id, target, reason);
    }),
  split: (e) =>
    run(e, async (form, reason) => {
      const { topic } = await context(e);
      return splitTopic(e.locals.ctx.db.repos, e.locals.perms, e.locals.user!, {
        topicId: topic.id,
        postIds: form.getAll("post").map(Number),
        title: String(form.get("title") ?? ""),
        targetNodeId: Number(form.get("forum")) || undefined,
        reason,
      });
    }),
  delete: (e) =>
    run(
      e,
      async (form, reason) => {
        const { topic } = await context(e);
        if (form.get("confirm") !== "on") return { ok: false, problem: "invalid" };
        return deleteTopic(e.locals.ctx.db.repos, e.locals.perms, e.locals.user!, topic.id, reason);
      },
      true,
    ),
};
