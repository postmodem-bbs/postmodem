// SPDX-License-Identifier: AGPL-3.0-or-later
// A post wherever it is now: /viewtopic.php?p=ID (classic) or /p/ID → the page of its topic
// that holds it, with the #pID anchor. 302: the page changes as posts come and go. A page
// route (not +server) so that following the link stays a client-side navigation.
import { error, redirect } from "@sveltejs/kit";
import { locatePost } from "#lib/server/board.ts";
import { parseRef } from "#lib/urls.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  const ref = parseRef(params.ref);
  if (!ref || !("id" in ref)) error(404, "Not found");
  const where = await locatePost(locals.ctx.db.repos, locals.perms, ref.id);
  if (!where) error(404, "Not found");
  if ("denied" in where) error(where.denied, where.denied === 403 ? "Forbidden" : "Not found");
  redirect(302, locals.urls.postOnPage(where.topic, where.start, ref.id));
};
