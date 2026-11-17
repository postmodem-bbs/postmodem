// SPDX-License-Identifier: AGPL-3.0-or-later
// The mapping is judged by the real engine: same answers phpBB2's auth() gave.
import { coreRegistry, evaluate, type Grant, GUEST, type Role, type Viewer } from "@postmodem/core";
import { describe, expect, it } from "vitest";
import {
  type AccessRow,
  AUTH_FIELDS,
  type AuthField,
  type ForumAuth,
  planForumGrants,
  roleSignature,
} from "./permissions.ts";

// The fixture generator's access models (auth_view … auth_pollcreate, as in tools/fixtures).
const MODEL = {
  public: [0, 0, 1, 1, 1, 1, 3, 3, 1, 1],
  registered: [1, 1, 1, 1, 1, 1, 3, 3, 1, 1],
  private: [2, 2, 2, 2, 2, 2, 3, 3, 2, 2],
  moderators: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
} as const;
const forum = (forumId: number, model: keyof typeof MODEL): ForumAuth => ({
  forumId,
  levels: Object.fromEntries(AUTH_FIELDS.map((f, i) => [f, MODEL[model][i]!])) as Record<AuthField, number>,
});
const flags = (on: AuthField[]) =>
  Object.fromEntries(AUTH_FIELDS.map((f) => [f, on.includes(f)])) as Record<AuthField, boolean>;

const CLUB = 1302;
const MODS = 1301;
const ADMINS = 5000;
const PERSONAL = new Map([[1007, 7]]); // personal group 1007 belongs to user 7

function board(grants: ReturnType<typeof planForumGrants>) {
  const roles = new Map<string, Role>();
  const out: Grant[] = grants.map((g, i) => {
    const sig = roleSignature(g.capabilities);
    if (!roles.has(sig))
      roles.set(sig, {
        id: roles.size + 1,
        key: `import:${roles.size}`,
        name: sig,
        builtin: false,
        capabilities: g.capabilities,
      });
    return { id: i + 1, roleId: roles.get(sig)!.id, subject: g.subject, nodeId: g.nodeId, createdAt: 0 };
  });
  const snapshot = { grants: out, roles: new Map([...roles.values()].map((r) => [r.id, r])) };
  const registry = coreRegistry();
  return (viewer: Viewer, cap: string, nodeId: number, path: string) =>
    evaluate(registry, snapshot, viewer, cap, nodeId, path).allowed;
}

describe("phpBB2 forum permissions", () => {
  const access: AccessRow[] = [
    {
      groupId: CLUB,
      forumId: 30,
      flags: flags(["auth_view", "auth_read", "auth_post", "auth_reply", "auth_vote"]),
      mod: false,
    },
    { groupId: 1007, forumId: 30, flags: flags(["auth_view", "auth_read"]), mod: false },
    { groupId: MODS, forumId: 40, flags: flags(AUTH_FIELDS), mod: true },
  ];
  // 10 public, its sub-forum 11 private-ish (registered), 20 registered, 30 private, 40 moderators.
  const grants = [
    ...planForumGrants(forum(10, "public"), access, PERSONAL, ADMINS),
    ...planForumGrants(forum(11, "registered"), access, PERSONAL, ADMINS),
    ...planForumGrants(forum(20, "registered"), access, PERSONAL, ADMINS),
    ...planForumGrants(forum(30, "private"), access, PERSONAL, ADMINS),
    ...planForumGrants(forum(40, "moderators"), access, PERSONAL, ADMINS),
  ];
  const can = board(grants);
  const member = { userId: 100, groupIds: [] };
  const clubber = { userId: 101, groupIds: [CLUB] };
  const personal = { userId: 7, groupIds: [] };
  const mod = { userId: 102, groupIds: [MODS] };
  const admin = { userId: 2, groupIds: [ADMINS] };

  it("public: guests read, members post, only moderators make stickies", () => {
    expect(can(GUEST, "node.read", 10, "/10/")).toBe(true);
    expect(can(GUEST, "topic.reply", 10, "/10/")).toBe(false);
    expect(can(member, "topic.reply", 10, "/10/")).toBe(true);
    expect(can(member, "topic.sticky", 10, "/10/")).toBe(false);
    expect(can(admin, "topic.sticky", 10, "/10/")).toBe(true);
  });

  it("a registered-only sub-forum doesn't inherit its public parent", () => {
    expect(can(GUEST, "node.view", 11, "/10/11/")).toBe(false);
    expect(can(member, "node.read", 11, "/10/11/")).toBe(true);
    expect(can(GUEST, "node.view", 20, "/20/")).toBe(false);
  });

  it("private: only the ACL group and the user with a personal grant get in", () => {
    expect(can(member, "node.view", 30, "/30/")).toBe(false);
    expect(can(clubber, "topic.reply", 30, "/30/")).toBe(true);
    expect(can(clubber, "post.edit.own", 30, "/30/")).toBe(false); // not in the group's row
    expect(can(personal, "node.read", 30, "/30/")).toBe(true);
    expect(can(personal, "topic.reply", 30, "/30/")).toBe(false);
    expect(can(admin, "node.read", 30, "/30/")).toBe(true);
  });

  it("moderators: the auth_mod group moderates, nobody else sees it", () => {
    expect(can(member, "node.view", 40, "/40/")).toBe(false);
    expect(can(mod, "topic.reply", 40, "/40/")).toBe(true);
    expect(can(mod, "moderate.lock", 40, "/40/")).toBe(true);
    expect(can(mod, "moderate.lock", 10, "/10/")).toBe(false); // only where they moderate
  });

  it("shares one role between identical capability sets", () => {
    const sigs = new Set(grants.map((g) => roleSignature(g.capabilities)));
    expect(sigs.size).toBeLessThan(grants.length);
  });
});
