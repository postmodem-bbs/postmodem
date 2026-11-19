// SPDX-License-Identifier: AGPL-3.0-or-later
import { redirect } from "@sveltejs/kit";
import { loadIndex } from "#lib/server/board.ts";
import { classicCategoryIds } from "#lib/server/links.ts";
import { forRequest } from "#lib/server/packages.ts";
import type { PageServerLoad } from "./$types";

const NOTICES = ["welcome", "verified", "reset"];

export const load: PageServerLoad = async ({ locals, url }) => {
  // phpBB2's /index.php is the index (hooks.ts sends it here); it has one address.
  if (url.pathname !== "/") redirect(301, "/");
  const { repos } = locals.ctx.db;
  const classic =
    locals.urls.style === "classic" ? await classicCategoryIds(repos, await repos.nodes.tree()) : undefined;
  const pkg = forRequest(locals);
  return {
    ...(await loadIndex(repos, locals.perms, { classic, decorate: pkg.decorate }))!,
    tools: await pkg.slot("forum.tools"),
    // One-off confirmations after a redirect (?notice=…), only for the signed-in user they concern.
    // After deleting their account the visitor is a guest: a goodbye that needs no account.
    goodbye: !locals.user && url.searchParams.get("notice") === "deleted",
    notice:
      locals.user && NOTICES.includes(url.searchParams.get("notice") ?? "")
        ? { kind: url.searchParams.get("notice"), name: locals.user.username }
        : null,
  };
};
