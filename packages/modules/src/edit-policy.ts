// SPDX-License-Identifier: AGPL-3.0-or-later
// edit-policy (tier 2, PACKAGES.md §2.2; Przemo's edit_time and not_edit_admin): an access
// filter (extension point #5) that narrows who may edit or delete a post. Members may change
// their own posts only for a while after posting; moderators may not change an
// administrator's posts. It can only refuse what the core's permissions allow, never more.
// The "edited by" display switches (show_action_edited_*) are not part of v0.
import { defineSetting, type PackageDefinition, type PolicyQuestion, type PolicyVote } from "@postmodem/core";
import { z } from "zod";

/** Minutes after posting during which members may edit or delete their own posts; 0 = always. */
export const editWindowMinutes = defineSetting({
  key: "edit-policy.windowMinutes",
  schema: z.number().int().min(0).max(525_600),
  default: 0,
});
/** Only administrators may edit or delete administrators' posts. */
export const protectAdminPosts = defineSetting({
  key: "edit-policy.protectAdminPosts",
  schema: z.boolean(),
  default: true,
});

/** The rule itself, separate from settings so it can be tested on its own. */
export function editPolicyVote(q: PolicyQuestion, window: number, protectAdmins: boolean): PolicyVote {
  const own = q.userId !== null && q.post.authorId === q.userId;
  if (protectAdmins && q.authorIsAdmin && !own && !q.perms.can("admin.access", null))
    return { deny: { package: "edit-policy", code: "admin-post" } };
  const moderator = q.perms.can(q.action === "post.edit" ? "moderate.edit" : "moderate.delete", q.node);
  if (own && !moderator && window > 0 && q.now - q.post.createdAt > window * 60_000)
    return { deny: { package: "edit-policy", code: "window-closed", params: { minutes: window } } };
  return "abstain";
}

export const editPolicy: PackageDefinition = {
  key: "edit-policy",
  name: "Edit policy",
  description: "A time limit on editing your own posts; administrators' posts protected from moderators.",
  tier: 2,
  version: "0.1.0",
  settings: [editWindowMinutes, protectAdminPosts],
  setup: (ctx) => ({
    content: {
      policy: (q) =>
        editPolicyVote(q, ctx.settings.get(editWindowMinutes), ctx.settings.get(protectAdminPosts)),
    },
  }),
};
