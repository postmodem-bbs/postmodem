// SPDX-License-Identifier: AGPL-3.0-or-later
// /memberlist.php — phpBB2's member list (M2 slice 6): ?mode=joined|username|posts&order=ASC|DESC&start=N.
import { memberlistForGuests } from "@postmodem/core";
import { error } from "@sveltejs/kit";
import { normaliseStart } from "#lib/pagination.ts";
import type { PageServerLoad } from "./$types";

const PER_PAGE = 50;
const MODES = ["joined", "username", "posts"] as const;

export const load: PageServerLoad = async ({ url, locals }) => {
  if (!locals.user && !locals.ctx.settings.get(memberlistForGuests)) error(403, "Forbidden");
  const mode = MODES.find((m) => m === url.searchParams.get("mode")) ?? "joined";
  const order =
    url.searchParams.get("order")?.toLowerCase() === "desc" ||
    (!url.searchParams.get("order") && mode === "posts")
      ? "desc"
      : "asc";
  const start = normaliseStart(url.searchParams.get("start"), PER_PAGE, Number.MAX_SAFE_INTEGER);
  const page = await locals.ctx.db.repos.users.list({
    sort: mode,
    order,
    page: { page: start / PER_PAGE + 1, perPage: PER_PAGE },
  });
  return {
    mode,
    order,
    start,
    perPage: PER_PAGE,
    total: page.total,
    members: page.items.map((u) => ({
      ref: { id: u.id, slug: u.slug },
      name: u.username,
      joined: u.createdAt,
      posts: u.postCount,
      location: u.location,
    })),
  };
};
