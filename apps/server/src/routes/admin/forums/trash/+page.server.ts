// SPDX-License-Identifier: AGPL-3.0-or-later
import { restoreTrashedTopic, TRASHED } from "@postmodem/modules";
import { error, fail } from "@sveltejs/kit";
import { requireAdmin } from "#lib/server/admin.ts";
import { reindexTopics } from "#lib/server/search.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals, url, "admin.forums");
  const { repos } = locals.ctx.db;
  const forum = await repos.nodes.get(Number(url.searchParams.get("forum")));
  if (forum?.kind !== "forum") error(404, "Not found");
  const page = Math.max(1, Math.min(1_000_000, Math.trunc(Number(url.searchParams.get("page"))) || 1));
  const trash = await repos.topics.listByNode(forum.id, { page, perPage: 30 }, { visibility: [TRASHED] });
  const forums = (await repos.nodes.tree()).filter((node) => node.kind === "forum");
  return {
    forum: { id: forum.id, title: forum.title },
    forums: forums.map(({ id, title }) => ({ id, title })),
    trash: trash.items.map(({ id, title }) => ({ id, title })),
    page,
    hasNext: page * 30 < trash.total,
  };
};

export const actions: Actions = {
  restore: async ({ locals, url, request }) => {
    const actor = requireAdmin(locals, url, "admin.forums");
    const form = await request.formData();
    const topicId = Number(form.get("topic"));
    const destination = Number(form.get("destination"));
    if (
      !Number.isSafeInteger(topicId) ||
      !Number.isSafeInteger(destination) ||
      topicId < 1 ||
      destination < 1
    )
      return fail(400, { restored: false });
    const { repos } = locals.ctx.db;
    const restored = await repos.transaction(async (tx) => {
      if (!(await restoreTrashedTopic(tx, topicId, destination, actor.id))) return false;
      await reindexTopics(tx, [topicId]);
      return true;
    });
    if (!restored) return fail(400, { restored: false });
    return { restored: true };
  },
};
