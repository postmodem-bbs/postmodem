// SPDX-License-Identifier: AGPL-3.0-or-later
// /viewforum.php?f=ID&start=N — phpBB2's own URL (ADR 0012, classic style).
import { error } from "@sveltejs/kit";
import { loadForum } from "#lib/server/board.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, locals }) => {
  const id = Number(url.searchParams.get("f"));
  if (!Number.isInteger(id) || id <= 0) error(404, "Not found");
  const data = await loadForum(locals.ctx.db.repos, locals.perms, id, url.searchParams.get("start"));
  if ("denied" in data) error(data.denied, data.denied === 403 ? "Forbidden" : "Not found");
  return data;
};
