// SPDX-License-Identifier: AGPL-3.0-or-later
// phpBB2 forum permissions → Postmodem grants (ADR 0015, ADR 0018).
//
// phpBB2 gives each forum one level per action — ALL (0), REG (1), ACL "private" (2),
// MOD (3), ADMIN (5) — and `auth_access` rows give groups (or one user, through their
// personal group) the ACL actions and moderator rights. Each forum becomes self-contained:
//   - everyone: allow what is ALL, explicitly deny the rest, so a sub-forum never inherits
//     its parent forum's access;
//   - registered: allow what is ALL or REG;
//   - each auth_access group/user: allow its ACL actions; moderators (auth_mod) also get the
//     MOD-level actions and moderate.*;
//   - the imported administrators group: everything (phpBB2 admins bypassed forum auth).
import type { Effect, Id, Subject } from "@postmodem/core";

export const AUTH_LEVEL = { ALL: 0, REG: 1, ACL: 2, MOD: 3, ADMIN: 5 } as const;

/** phpBB2 auth columns that core capabilities cover. */
export const AUTH_CAPABILITY = {
  auth_view: "node.view",
  auth_read: "node.read",
  auth_post: "topic.create",
  auth_reply: "topic.reply",
  auth_edit: "post.edit.own",
  auth_delete: "post.delete.own",
  auth_sticky: "topic.sticky",
  auth_announce: "topic.announce",
  auth_vote: "poll.vote",
  auth_pollcreate: "poll.create",
} as const;
export type AuthField = keyof typeof AUTH_CAPABILITY;
export const AUTH_FIELDS = Object.keys(AUTH_CAPABILITY) as AuthField[];

/** Auth columns that belong to packages, reported as not imported (PACKAGES §0). */
export const PACKAGE_AUTH_FIELDS = {
  auth_globalannounce: "global-announcements",
  auth_attachments: "attachments",
  auth_download: "attachments",
} as const;

export interface ForumAuth {
  forumId: Id;
  levels: Record<AuthField, number>;
}
export interface AccessRow {
  groupId: Id;
  forumId: Id;
  flags: Record<AuthField, boolean>;
  mod: boolean;
}
export interface PlannedGrant {
  nodeId: Id;
  subject: Subject;
  capabilities: Record<string, Effect>;
}

export function planForumGrants(
  forum: ForumAuth,
  access: AccessRow[],
  personalGroups: ReadonlyMap<Id, Id>,
  adminGroupId: Id | null,
): PlannedGrant[] {
  const level = (f: AuthField) => forum.levels[f] ?? AUTH_LEVEL.ADMIN;
  const capsWhere = (pred: (f: AuthField) => boolean) =>
    AUTH_FIELDS.filter(pred).map((f): string => AUTH_CAPABILITY[f]);
  const allowAll = (caps: string[]) => Object.fromEntries(caps.map((c) => [c, "allow" as Effect]));
  const grants: PlannedGrant[] = [];
  const nodeId = forum.forumId;

  const everyone: Record<string, Effect> = {};
  for (const f of AUTH_FIELDS) everyone[AUTH_CAPABILITY[f]] = level(f) === AUTH_LEVEL.ALL ? "allow" : "deny";
  grants.push({ nodeId, subject: { type: "everyone" }, capabilities: everyone });

  const registered = capsWhere((f) => level(f) <= AUTH_LEVEL.REG);
  if (registered.length)
    grants.push({ nodeId, subject: { type: "registered" }, capabilities: allowAll(registered) });

  // One grant per subject, merging rows (a user can appear through several groups' rows only
  // as different subjects, but stay safe if a board has duplicate rows).
  const bySubject = new Map<string, PlannedGrant>();
  for (const row of access.filter((r) => r.forumId === forum.forumId)) {
    const caps = capsWhere((f) => level(f) === AUTH_LEVEL.ACL && (row.flags[f] || row.mod));
    if (row.mod) caps.push(...capsWhere((f) => level(f) === AUTH_LEVEL.MOD), "moderate.*");
    if (!caps.length) continue;
    const userId = personalGroups.get(row.groupId);
    const subject: Subject =
      userId !== undefined ? { type: "user", id: userId } : { type: "group", id: row.groupId };
    const key = `${subject.type}:${"id" in subject ? subject.id : ""}`;
    const existing = bySubject.get(key);
    if (existing) Object.assign(existing.capabilities, allowAll(caps));
    else bySubject.set(key, { nodeId, subject, capabilities: allowAll(caps) });
  }
  grants.push(...bySubject.values());

  if (adminGroupId !== null)
    grants.push({ nodeId, subject: { type: "group", id: adminGroupId }, capabilities: { "*": "allow" } });
  return grants;
}

/** Stable identity of a capability set, so identical sets share one imported role. */
export function roleSignature(capabilities: Record<string, Effect>): string {
  return Object.entries(capabilities)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

/** Short human name for an imported role, e.g. "Imported: view, read, reply (deny: post)". */
export function roleName(capabilities: Record<string, Effect>): string {
  const short = (k: string) => k.replace(/^(node|topic|poll|post)\./, "");
  const allow = Object.entries(capabilities)
    .filter(([, e]) => e === "allow")
    .map(([k]) => short(k));
  const deny = Object.entries(capabilities)
    .filter(([, e]) => e !== "allow")
    .map(([k]) => short(k));
  const name = `Imported: ${allow.join(", ") || "nothing"}${deny.length ? ` (deny: ${deny.join(", ")})` : ""}`;
  return name.length > 120 ? `${name.slice(0, 117)}…` : name;
}
