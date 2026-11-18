// SPDX-License-Identifier: AGPL-3.0-or-later
// Watch or stop watching a topic (phpBB2's viewtopic.php?watch=topic, as a POST).
import { error, redirect } from "@sveltejs/kit";
import { topicRef } from "#lib/server/board.ts";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) redirect(303, "/login.php");
  const { repos } = locals.ctx.db;
  const topic = await repos.topics.get(Number(url.searchParams.get("t")) || 0);
  const node = topic?.visibility === "core:public" ? await repos.nodes.get(topic.nodeId) : undefined;
  if (!topic || !node || !locals.perms.can("node.read", node)) error(404, "Not found");
  if (url.searchParams.get("on") === "1") await repos.watches.watch(locals.user.id, topic.id);
  else await repos.watches.unwatch(locals.user.id, topic.id);
  redirect(303, locals.urls.topic(topicRef(topic)));
};
