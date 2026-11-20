// SPDX-License-Identifier: AGPL-3.0-or-later
// /posting.php — phpBB2's URL for every way of writing (M2 slice 1):
//   ?mode=newtopic&f=ID   ?mode=reply&t=ID   ?mode=quote&p=ID   ?mode=editpost&p=ID
//   ?mode=delete&p=ID (asks first; deleting is a POST)
// The rules live in @postmodem/core (posting.ts); this page only collects the form and shows
// what the core says. Plain forms; the toolbar and preview are enhancements.
import {
  boardAdmins,
  createTopic,
  deletePost,
  editPost,
  floodSeconds,
  type Id,
  maxPostLength,
  may,
  newMemberPosts,
  type PostingProblem,
  packageDenial,
  reply,
  type TopicType,
} from "@postmodem/core";
import { translator } from "@postmodem/i18n";
import { error, fail, redirect } from "@sveltejs/kit";
import { nodeRef, topicRef } from "#lib/server/board.ts";
import { classicCategoryIds } from "#lib/server/links.ts";
import { afterPost } from "#lib/server/notifications.ts";
import { quoteSource } from "#lib/server/posting.ts";
import { readerOf } from "#lib/server/reader.ts";
import { indexPosts, searchPlan } from "#lib/server/search.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

type Mode = "newtopic" | "reply" | "quote" | "editpost" | "delete";
const MODES: Mode[] = ["newtopic", "reply", "quote", "editpost", "delete"];

const id = (v: string | null) => (v && /^\d{1,15}$/.test(v) ? Number(v) : null);

/** Everything the form is about, from the URL; 404/403 for what the viewer can't write to. */
async function context(event: Pick<RequestEvent, "url" | "locals">) {
  const { url, locals } = event;
  const mode = url.searchParams.get("mode") as Mode;
  if (!MODES.includes(mode)) error(404, "Not found");
  if (!locals.user) redirect(303, `/login.php?redirect=${encodeURIComponent(url.pathname + url.search)}`);
  const { repos } = locals.ctx.db;
  const perms = locals.perms;
  const userId = locals.user.id;

  if (mode === "newtopic") {
    const node = await repos.nodes.get(id(url.searchParams.get("f")) ?? 0);
    if (node?.kind !== "forum" || !perms.can("node.read", node)) error(404, "Not found");
    if (!may.createTopic(perms, node)) error(403, "Forbidden");
    return { mode, node, topic: null, post: null };
  }
  const topicFrom = async (topicId: Id) => {
    const topic = await repos.topics.get(topicId);
    const node =
      topic && topic.visibility === "core:public" ? await repos.nodes.get(topic.nodeId) : undefined;
    if (!topic || !node || !perms.can("node.read", node)) error(404, "Not found");
    return { topic, node };
  };
  if (mode === "reply") {
    const { topic, node } = await topicFrom(id(url.searchParams.get("t")) ?? 0);
    if (!may.reply(perms, node, topic)) error(403, "Forbidden");
    return { mode, node, topic, post: null };
  }
  const post = await repos.posts.get(id(url.searchParams.get("p")) ?? 0);
  if (post?.visibility !== "core:public") error(404, "Not found");
  const { topic, node } = await topicFrom(post.topicId);
  const allowed =
    mode === "quote"
      ? may.reply(perms, node, topic)
      : mode === "editpost"
        ? may.edit(perms, node, topic, post, userId)
        : may.delete(perms, node, topic, post, userId);
  if (!allowed) error(403, "Forbidden");
  if (mode === "editpost" || mode === "delete") {
    // Packages' access filters (EP-5) may refuse; the reader sees their reason.
    const hooks = locals.ctx.packages.contentHooks();
    const refusal = hooks.policy
      ? packageDenial(
          hooks,
          {
            action: mode === "editpost" ? "post.edit" : "post.delete",
            perms,
            userId,
            node,
            topic,
            post,
            now: Date.now(),
          },
          await boardAdmins(repos),
        )
      : null;
    if (refusal)
      error(403, translator(locals.locale)(`${refusal.package}-${refusal.code}`, refusal.params ?? {}));
  }
  return { mode, node, topic, post };
}

export const load: PageServerLoad = async (event) => {
  const { mode, node, topic, post } = await context(event);
  const { repos } = event.locals.ctx.db;
  const classic =
    event.locals.urls.style === "classic"
      ? await classicCategoryIds(repos, await repos.nodes.tree())
      : undefined;
  let values = { title: "", subject: "", source: "", type: "normal" as TopicType };
  if (post && mode === "quote") {
    const author = post.authorId ? (await repos.users.get(post.authorId))?.username : post.authorName;
    values = { ...values, source: quoteSource(author ?? "", post.source) };
  }
  if (post && mode === "editpost")
    values = {
      ...values,
      source: post.source,
      subject: post.subject,
      title: topic?.firstPostId === post.id ? topic.title : "",
    };
  const perms = event.locals.perms;
  return {
    mode,
    forum: { ...nodeRef(node, classic), title: node.title },
    topic: topic ? { ...topicRef(topic), title: topic.title } : null,
    postId: post?.id ?? null,
    editsTitle: mode === "newtopic" || (mode === "editpost" && topic?.firstPostId === post?.id),
    types:
      mode === "newtopic"
        ? ([
            "normal",
            ...(perms.can("topic.sticky", node) ? ["sticky"] : []),
            ...(perms.can("topic.announce", node) ? ["announcement"] : []),
          ] as TopicType[])
        : [],
    values,
    maxLength: event.locals.ctx.settings.get(maxPostLength),
  };
};

const STATUS: Record<PostingProblem, number> = {
  "sign-in": 401,
  "not-found": 404,
  forbidden: 403,
  locked: 403,
  flood: 429,
  "title-missing": 400,
  "title-long": 400,
  "body-missing": 400,
  "body-long": 400,
  "not-last-post": 409,
  "new-member-links": 403,
  refused: 403,
};

export const actions: Actions = {
  submit: async (event) => {
    const { mode, node, topic, post } = await context(event);
    const { locals } = event;
    const { ctx } = locals;
    const form = await event.request.formData();
    const values = {
      title: String(form.get("title") ?? ""),
      subject: String(form.get("subject") ?? ""),
      source: String(form.get("source") ?? "").replace(/\r\n/g, "\n"),
      type: (String(form.get("type") ?? "normal") || "normal") as TopicType,
    };
    if (form.get("intent") === "preview")
      return { values, preview: await ctx.renderer.preview(values.source, readerOf(locals)) };

    const now = Date.now();
    const key = String(locals.user!.id);
    const rules = {
      floodSeconds: ctx.settings.get(floodSeconds),
      newMemberPosts: ctx.settings.get(newMemberPosts),
      maxLength: ctx.settings.get(maxPostLength),
      now,
      hooks: ctx.packages.contentHooks(),
    };
    const isNew = mode !== "editpost";
    if (isNew) {
      const wait = await ctx.throttles.posting.wait(key, now);
      if (wait > 0)
        return fail(429, { values, problem: "flood" as PostingProblem, waitSeconds: Math.ceil(wait / 1000) });
    }
    const result =
      mode === "newtopic"
        ? await createTopic(ctx.db.repos, locals.perms, locals.user, { nodeId: node.id, ...values }, rules)
        : mode === "editpost"
          ? await editPost(
              ctx.db.repos,
              locals.perms,
              locals.user,
              {
                postId: post!.id,
                source: values.source,
                subject: values.subject,
                ...(topic?.firstPostId === post!.id ? { title: values.title } : {}),
              },
              rules,
            )
          : await reply(
              ctx.db.repos,
              locals.perms,
              locals.user,
              { topicId: topic!.id, source: values.source, subject: values.subject },
              rules,
            );
    if (!result.ok)
      return fail(STATUS[result.problem], {
        values,
        problem: result.problem,
        waitSeconds: result.waitSeconds ?? 0,
        refusal: result.refusal ?? null,
      });
    if (isNew) await ctx.throttles.posting.fail(key, now);
    // Render now, so the first reader doesn't pay for it.
    await ctx.renderer.render([result.post]);
    const happened = { topic: result.topic, post: result.post, actor: locals.user! };
    await ctx.packages.emit(
      mode === "newtopic" ? "topic.created" : mode === "editpost" ? "post.edited" : "post.created",
      happened,
      locals.requestContext,
    );
    await indexPosts(ctx.db.repos, [result.post], searchPlan(ctx.packages.searchContributions()));
    if (mode !== "editpost") await afterPost(ctx, locals.urls, result.topic, result.post, locals.user!);
    ctx.log.info(mode === "editpost" ? "post edited" : "post created", {
      postId: result.post.id,
      userId: locals.user!.id,
    });
    redirect(303, locals.urls.post(result.post.id));
  },
  delete: async (event) => {
    const { post, node } = await context(event);
    const { locals } = event;
    const result = await locals.ctx.db.repos.transaction(async (tx) => {
      const deleted = await deletePost(tx, locals.perms, locals.user, post!.id, {
        hooks: locals.ctx.packages.contentHooks(),
      });
      if (deleted.ok && deleted.firstPostChanged && deleted.topic.firstPostId !== null) {
        const first = await tx.posts.get(deleted.topic.firstPostId);
        if (first) await indexPosts(tx, [first]);
      }
      return deleted;
    });
    if (!result.ok)
      return fail(STATUS[result.problem], { problem: result.problem, refusal: result.refusal ?? null });
    locals.ctx.log.info("post deleted", { postId: post!.id, userId: locals.user!.id });
    await locals.ctx.packages.emit("post.deleted", {
      topic: result.topic,
      post: result.post,
      actor: locals.user!,
      topicDeleted: !!result.topicDeleted,
    });
    redirect(
      303,
      result.topicDeleted ? locals.urls.forum(nodeRef(node)) : locals.urls.topic(topicRef(result.topic)),
    );
  },
};
