// SPDX-License-Identifier: AGPL-3.0-or-later
// A topic, in any URL style (ADR 0012): /viewtopic.php?t=ID&start=N, /t/ID-slug?page=N or
// /topic/slug?page=N all land here (hooks.ts) and are redirected to the canonical one.
import { error, redirect } from "@sveltejs/kit";
import { loadTopic, POSTS_PER_PAGE } from "#lib/server/board.ts";
import { jsonLdTag } from "#lib/server/jsonld.ts";
import { absoluteUrl, classicCategoryIds, ensureCanonical, resolveTopic } from "#lib/server/links.ts";
import { topicVisited } from "#lib/server/notifications.ts";
import { forRequest } from "#lib/server/packages.ts";
import { TOPIC_VIEWS } from "#lib/server/platform.ts";
import { readerOf } from "#lib/server/reader.ts";
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
    (posts, node) =>
      locals.ctx.renderer.render(posts, (keys) =>
        locals.ctx.packages.visibleRenderHoles({ topic, node, perms: locals.perms }, keys),
      ),
    {
      add: (id) => locals.ctx.platform.counters.hit(TOPIC_VIEWS, id),
      pending: async (id) =>
        (await locals.ctx.platform.counters.pending(TOPIC_VIEWS, [id])).get(String(id)) ?? 0,
    },
    topic,
    requestedStart(url.searchParams, POSTS_PER_PAGE),
    urls.style === "classic" ? await classicCategoryIds(repos, await repos.nodes.tree()) : undefined,
    locals.ctx.packages.contentHooks(),
    locals.locale,
  );
  if (!data) error(404, "Not found");
  if ("denied" in data) error(data.denied, data.denied === 403 ? "Forbidden" : "Not found");
  if ("movedTo" in data && data.movedTo) redirect(301, urls.topic(data.movedTo));
  ensureCanonical(url, urls.topic(data.topic, data.start));

  // Packages: the "viewed" event (read marks) and their slots on this page.
  const pkg = forRequest(locals);
  await locals.ctx.packages.emit("topic.viewed", {
    topic,
    viewer: locals.perms.viewer,
    lastPostAt: topic.lastPostAt,
  });
  await topicVisited(locals.ctx, locals.user, topic);
  const watching = locals.user ? await repos.watches.isWatching(locals.user.id, topic.id) : null;
  const node = await repos.nodes.get(topic.nodeId);
  const raw = await repos.posts.getMany(data.posts.map((p) => p.id));
  const postSlots = Object.fromEntries(
    await pkg.postActions(
      { topic, ...(node ? { node } : {}) },
      data.posts.flatMap((p) => (raw.has(p.id) ? [raw.get(p.id)!] : [])),
    ),
  );
  const afterPosts = await pkg.slot("topic.afterPosts", { topic, node });
  // Signatures (phpBB2 showed them under every post): rendered once per author per page.
  const reader = readerOf(locals);
  const authors = await repos.users.getMany(data.posts.flatMap((p) => (p.authorRef ? [p.authorRef.id] : [])));
  const signatures = new Map<number, string>();
  for (const [id, u] of authors)
    if (u.signatureSource.trim())
      signatures.set(id, await locals.ctx.renderer.preview(u.signatureSource, reader));

  // The renderer has already resolved private fragments for this topic reader.
  const { messages } = reader;
  const site = locals.ctx.config.publicUrl;
  return {
    ...data,
    canonical: absoluteUrl(site, urls.topic(data.topic, data.start)),
    description: data.summary?.description ?? "",
    jsonLd: data.summary ? jsonLdTag(discussionPosting(data, site, urls)) : "",
    posts: data.posts.map((p) => ({
      signature: (p.authorRef && signatures.get(p.authorRef.id)) || "",
      ...p,
      slots: postSlots[p.id] ?? [],
      html: locals.ctx.renderer.forReader(p.html, locals.user?.username ?? null, messages),
    })),
    afterPosts,
    watching,
  };
};

/** schema.org DiscussionForumPosting for a topic's first page (DESIGN, M1 slice 3). */
function discussionPosting(
  data: NonNullable<Awaited<ReturnType<typeof loadTopic>>> & { posts: unknown[] },
  site: string,
  urls: App.Locals["urls"],
) {
  if (!("topic" in data) || !data.summary) return null;
  const { topic, summary } = data;
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
    headline: topic.title,
    url: absoluteUrl(site, urls.topic(topic)),
    text: summary.text,
    datePublished: iso(topic.createdAt),
    ...(topic.lastPostAt ? { dateModified: iso(topic.lastPostAt) } : {}),
    author: {
      "@type": "Person",
      name: summary.author.author,
      ...(summary.author.authorRef ? { url: absoluteUrl(site, urls.user(summary.author.authorRef)) } : {}),
    },
    interactionStatistic: [
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/CommentAction",
        userInteractionCount: topic.replies,
      },
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/ViewAction",
        userInteractionCount: topic.viewCount,
      },
    ],
  };
}
