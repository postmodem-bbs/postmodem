// SPDX-License-Identifier: AGPL-3.0-or-later
// revisions: /revisions?p=ID lists a post's earlier versions, newest first, for moderators
// (and the author, if the board allows). 404 when the package is off or the post is unknown.
import { maySeeRevisions, revisionsAuthorsSee, revisionsStore } from "@postmodem/modules";
import { error } from "@sveltejs/kit";
import { topicRef } from "#lib/server/board.ts";
import { readerOf } from "#lib/server/reader.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const { ctx } = locals;
  if (!ctx.packages.isEnabled("revisions")) error(404, "Not found");
  const { repos } = ctx.db;
  const post = await repos.posts.get(Number(url.searchParams.get("p")) || 0);
  const topic = post?.visibility === "core:public" ? await repos.topics.get(post.topicId) : undefined;
  const node = topic?.visibility === "core:public" ? await repos.nodes.get(topic.nodeId) : undefined;
  if (!post || !topic || !node || !locals.perms.can("node.read", node)) error(404, "Not found");
  if (!maySeeRevisions(locals.perms, node, post.authorId, ctx.settings.get(revisionsAuthorsSee)))
    error(403, "Forbidden");

  const versions = await revisionsStore(ctx.db.kysely.withoutPlugins()).forPost(post.id);
  const editors = await repos.users.getMany(versions.flatMap((v) => (v.editedBy ? [v.editedBy] : [])));
  const reader = readerOf(locals);
  return {
    post: { id: post.id, subject: post.subject, html: await ctx.renderer.preview(post.source, reader) },
    topic: { ...topicRef(topic), title: topic.title },
    versions: await Promise.all(
      versions.map(async (v) => ({
        id: v.id,
        subject: v.subject,
        replacedAt: v.replacedAt,
        editor: (v.editedBy && editors.get(v.editedBy)?.username) || null,
        html: await ctx.renderer.preview(v.body, reader),
      })),
    ),
  };
};
