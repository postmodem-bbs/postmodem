// SPDX-License-Identifier: AGPL-3.0-or-later
// unread-tracking: "mark forum read" (?f=ID) and "mark all read" (?all=1). POST only; the
// package's forms send members back where they came from.
import { unreadStore } from "@postmodem/modules";
import { error, redirect } from "@sveltejs/kit";
import { nodeRef } from "#lib/server/board.ts";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ url, locals }) => {
  if (!locals.ctx.packages.isEnabled("unread-tracking")) error(404, "Not found");
  if (!locals.user) redirect(303, "/login.php");
  const store = unreadStore(locals.ctx.db.kysely.withoutPlugins());
  const f = Number(url.searchParams.get("f"));
  if (Number.isInteger(f) && f > 0) {
    const node = await locals.ctx.db.repos.nodes.get(f);
    if (!node || !locals.perms.can("node.read", node)) error(404, "Not found");
    await store.markNode(locals.user.id, node.id, Date.now());
    redirect(303, locals.urls.node(nodeRef(node)));
  }
  await store.markNode(locals.user.id, 0, Date.now());
  redirect(303, "/");
};
