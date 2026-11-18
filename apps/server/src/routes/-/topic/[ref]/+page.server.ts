// SPDX-License-Identifier: AGPL-3.0-or-later
// A topic, in any URL style (ADR 0012): /viewtopic.php?t=ID&start=N, /t/ID-slug?page=N or
// /topic/slug?page=N all land here (hooks.ts) and are redirected to the canonical one.
import { translator } from "@postmodem/i18n";
import { error, redirect } from "@sveltejs/kit";
import { loadTopic, POSTS_PER_PAGE } from "#lib/server/board.ts";
import { absoluteUrl, classicCategoryIds, ensureCanonical, resolveTopic } from "#lib/server/links.ts";
import { requestedStart } from "#lib/urls.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, params, locals }) => {
  const { repos } = locals.ctx.db;
  const urls = locals.urls;
  const topic = await resolveTopic(repos, params.ref);
  if (!topic) error(404, "Not found");
  const data = await loadTopic(
    repos,
    locals.perms,
    (posts) => locals.ctx.renderer.render(posts),
    topic,
    requestedStart(url.searchParams, POSTS_PER_PAGE),
    urls.style === "classic" ? await classicCategoryIds(repos, await repos.nodes.tree()) : undefined,
  );
  if (!data) error(404, "Not found");
  if ("denied" in data) error(data.denied, data.denied === 403 ? "Forbidden" : "Not found");
  if ("movedTo" in data && data.movedTo) redirect(301, urls.topic(data.movedTo));
  ensureCanonical(url, urls.topic(data.topic, data.start));

  // Reader-dependent parts of the cached HTML ([you], [hide]).
  const t = translator(locals.locale);
  const messages = { guest: t("post-guest"), hiddenContent: t("bb-hidden-content") };
  return {
    ...data,
    canonical: absoluteUrl(locals.ctx.config.publicUrl, urls.topic(data.topic, data.start)),
    posts: data.posts.map((p) => ({ ...p, html: locals.ctx.renderer.forReader(p.html, null, messages) })),
  };
};
