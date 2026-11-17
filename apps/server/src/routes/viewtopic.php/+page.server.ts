// SPDX-License-Identifier: AGPL-3.0-or-later
// /viewtopic.php?t=ID&start=N and ?p=POST — phpBB2's own URLs (ADR 0012, classic style).
import { translator } from "@postmodem/i18n";
import { error, redirect } from "@sveltejs/kit";
import { loadTopic, locatePost } from "#lib/server/board.ts";
import { urls } from "#lib/urls.ts";
import type { PageServerLoad } from "./$types";

const positiveInt = (v: string | null) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const load: PageServerLoad = async ({ url, locals }) => {
  const { repos } = locals.ctx.db;
  const postId = positiveInt(url.searchParams.get("p"));
  if (postId !== null) {
    const where = await locatePost(repos, postId);
    if (!where) error(404, "Not found");
    redirect(302, `${urls.topic(where.topicId, where.start)}#p${postId}`);
  }
  const id = positiveInt(url.searchParams.get("t"));
  if (id === null) error(404, "Not found");

  const data = await loadTopic(
    repos,
    (posts) => locals.ctx.renderer.render(posts),
    id,
    url.searchParams.get("start"),
  );
  if (!data) error(404, "Not found");
  if ("movedTo" in data && data.movedTo) redirect(301, urls.topic(data.movedTo));
  if (!("posts" in data) || !data.posts) error(404, "Not found");

  // Reader-dependent parts of the cached HTML ([you], [hide]); no accounts yet, so a guest.
  const t = translator(locals.locale);
  const messages = { guest: t("post-guest"), hiddenContent: t("bb-hidden-content") };
  return {
    ...data,
    posts: data.posts.map((p) => ({ ...p, html: locals.ctx.renderer.forReader(p.html, null, messages) })),
  };
};
