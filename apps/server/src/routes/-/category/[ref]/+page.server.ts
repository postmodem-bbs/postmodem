// SPDX-License-Identifier: AGPL-3.0-or-later
// One category of the index, as phpBB2's index.php?c=N showed it, in any URL style (ADR 0012):
// /index.php?c=N (imported boards: the old category number), /c/ID-slug, /category/slug.
import { error, redirect } from "@sveltejs/kit";
import { loadIndex } from "#lib/server/board.ts";
import { absoluteUrl, classicCategoryIds, ensureCanonical, resolveNode } from "#lib/server/links.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, params, locals }) => {
  const { repos } = locals.ctx.db;
  const urls = locals.urls;
  const node = await resolveNode(repos, params.ref);
  if (!node || !locals.perms.can("node.view", node)) error(404, "Not found");
  // Przemo's sub-forum categories became their forum on import; old links follow.
  if (node.kind !== "category") redirect(301, urls.forum(node));
  const classic =
    urls.style === "classic" ? await classicCategoryIds(repos, await repos.nodes.tree()) : undefined;
  const data = await loadIndex(repos, locals.perms, { categoryId: node.id, classic });
  if (!data?.category) error(404, "Not found");
  ensureCanonical(url, urls.category(data.category));
  return {
    ...data,
    notice: null,
    canonical: absoluteUrl(locals.ctx.config.publicUrl, urls.category(data.category)),
  };
};
