// SPDX-License-Identifier: AGPL-3.0-or-later
// A public profile, in any URL style (ADR 0012): /profile.php?mode=viewprofile&u=ID,
// /u/ID-slug or /user/slug: public fields, the post count and recent topics in forums the
// viewer may read.
import { error } from "@sveltejs/kit";
import { rankView } from "#lib/server/board.ts";
import { absoluteUrl, ensureCanonical, resolveUser } from "#lib/server/links.ts";
import type { PageServerLoad } from "./$types";

const RECENT_TOPICS = 10;

export const load: PageServerLoad = async ({ url, params, locals }) => {
  const user = await resolveUser(locals.ctx.db.repos, params.ref);
  // Accounts that never became members (or were removed) have no public profile.
  if (!user || user.status === "pending" || user.status === "deleted" || user.origin !== "local")
    error(404, "Not found");
  const ref = { id: user.id, slug: user.slug };
  ensureCanonical(url, locals.urls.user(ref));
  const { repos } = locals.ctx.db;
  const readable = (await repos.nodes.tree()).filter(
    (n) => n.kind === "forum" && locals.perms.can("node.read", n),
  );
  const titles = new Map(readable.map((n) => [n.id, n.title]));
  const topics = await repos.topics.recentByAuthor(user.id, [...titles.keys()], RECENT_TOPICS);
  return {
    recentTopics: topics.map((t) => ({
      ref: { id: t.id, slug: t.slug },
      title: t.title,
      at: t.createdAt,
      forum: titles.get(t.nodeId) ?? "",
    })),
    profile: {
      ...ref,
      username: user.username,
      joined: user.createdAt,
      lastSeen: user.lastSeenAt,
      posts: user.postCount,
      rank: rankView(await repos.ranks.all(), user),
      location: user.location,
      website: /^https?:\/\//i.test(user.website) ? user.website : "",
    },
    canonical: absoluteUrl(locals.ctx.config.publicUrl, locals.urls.user(ref)),
  };
};
