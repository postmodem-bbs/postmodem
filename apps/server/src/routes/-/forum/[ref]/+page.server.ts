// SPDX-License-Identifier: AGPL-3.0-or-later
// A forum, in any URL style (ADR 0012): /viewforum.php?f=ID&start=N, /f/ID-slug?page=N or
// /forum/slug?page=N, redirected to the canonical one. A category reached here goes to its own URL.
import { error, redirect } from "@sveltejs/kit";
import { loadForum, TOPICS_PER_PAGE } from "#lib/server/board.ts";
import { absoluteUrl, classicCategoryIds, ensureCanonical, resolveNode } from "#lib/server/links.ts";
import { requestedStart } from "#lib/urls.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, params, locals }) => {
  const { repos } = locals.ctx.db;
  const urls = locals.urls;
  const node = await resolveNode(repos, params.ref);
  if (!node) error(404, "Not found");
  const classic =
    urls.style === "classic" ? await classicCategoryIds(repos, await repos.nodes.tree()) : undefined;
  if (node.kind === "category") {
    if (!locals.perms.can("node.view", node)) error(404, "Not found");
    redirect(
      301,
      urls.category({ id: node.id, slug: node.slug, kind: node.kind, classicId: classic?.get(node.id) }),
    );
  }
  const data = await loadForum(
    repos,
    locals.perms,
    node,
    requestedStart(url.searchParams, TOPICS_PER_PAGE),
    classic,
  );
  if ("denied" in data) error(data.denied, data.denied === 403 ? "Forbidden" : "Not found");
  ensureCanonical(url, urls.forum(data.forum, data.start));
  return { ...data, canonical: absoluteUrl(locals.ctx.config.publicUrl, urls.forum(data.forum, data.start)) };
};
