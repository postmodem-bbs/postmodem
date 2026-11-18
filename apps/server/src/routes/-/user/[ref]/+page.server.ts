// SPDX-License-Identifier: AGPL-3.0-or-later
// A public profile, in any URL style (ADR 0012): /profile.php?mode=viewprofile&u=ID,
// /u/ID-slug or /user/slug. Minimal for now: public fields and the post count.
import { error } from "@sveltejs/kit";
import { absoluteUrl, ensureCanonical, resolveUser } from "#lib/server/links.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, params, locals }) => {
  const user = await resolveUser(locals.ctx.db.repos, params.ref);
  // Accounts that never became members (or were removed) have no public profile.
  if (!user || user.status === "pending" || user.status === "deleted" || user.origin !== "local")
    error(404, "Not found");
  const ref = { id: user.id, slug: user.slug };
  ensureCanonical(url, locals.urls.user(ref));
  return {
    profile: {
      ...ref,
      username: user.username,
      joined: user.createdAt,
      lastSeen: user.lastSeenAt,
      posts: user.postCount,
      location: user.location,
      website: /^https?:\/\//i.test(user.website) ? user.website : "",
    },
    canonical: absoluteUrl(locals.ctx.config.publicUrl, locals.urls.user(ref)),
  };
};
