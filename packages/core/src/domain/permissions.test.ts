// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { BUILTIN_ROLES, coreRegistry, permissionsFor } from "./core-permissions.ts";
import {
  CapabilityRegistry,
  evaluate,
  explain,
  GUEST,
  type PermissionSnapshot,
  roleEffect,
  type Viewer,
} from "./permissions.ts";
import type { Effect, Grant, Id, Role, Subject } from "./types.ts";

// Board: category 1 > forum 2 > sub-forum 3; forum 4 at the top level.
const N = {
  cat: { id: 1, path: "/1/" },
  forum: { id: 2, path: "/1/2/" },
  sub: { id: 3, path: "/1/2/3/" },
  other: { id: 4, path: "/4/" },
};
const registry = coreRegistry();
const roles = BUILTIN_ROLES.map((r, i): Role => ({ id: i + 1, builtin: true, ...r }));
const role = (key: string) => roles.find((r) => r.key === key)!.id;

function snapshot(...grants: [string, Subject, Id | null][]): PermissionSnapshot {
  return {
    roles: new Map(roles.map((r) => [r.id, r])),
    grants: grants.map(([key, subject, nodeId], i) => ({
      id: i + 1,
      roleId: role(key),
      subject,
      nodeId,
      createdAt: 0,
    })),
  };
}
const defaults: [string, Subject, Id | null][] = [
  ["core:reader", { type: "everyone" }, null],
  ["core:participant", { type: "registered" }, null],
];
const user = (userId: Id, ...groupIds: Id[]): Viewer => ({ userId, groupIds });
const can = (s: PermissionSnapshot, v: Viewer, cap: string, node: { id: Id; path: string } | null) =>
  permissionsFor(registry, s, v).can(cap, node);

describe("permission scenarios", () => {
  it("phpBB2 defaults: guests read, registered users post", () => {
    const s = snapshot(...defaults);
    expect(can(s, GUEST, "node.read", N.sub)).toBe(true);
    expect(can(s, GUEST, "topic.reply", N.sub)).toBe(false);
    expect(can(s, user(10), "topic.reply", N.sub)).toBe(true);
    expect(can(s, user(10), "moderate.lock", N.sub)).toBe(false);
  });

  it("nothing granted means nothing allowed", () => {
    expect(can(snapshot(), user(10), "node.view", N.forum)).toBe(false);
  });

  it("a forum hidden from everyone can be opened to registered users or a group", () => {
    const s = snapshot(
      ...defaults,
      ["core:hidden", { type: "everyone" }, N.forum.id],
      ["core:participant", { type: "group", id: 7 }, N.forum.id],
    );
    expect(can(s, GUEST, "node.view", N.forum)).toBe(false);
    expect(can(s, user(10), "node.view", N.forum)).toBe(false);
    expect(can(s, user(11, 7), "topic.reply", N.forum)).toBe(true);
    // …and the sub-forum inherits it, while a sibling does not.
    expect(can(s, GUEST, "node.view", N.sub)).toBe(false);
    expect(can(s, user(11, 7), "topic.reply", N.sub)).toBe(true);
    expect(can(s, GUEST, "node.read", N.other)).toBe(true);
  });

  it("nearer scopes override farther ones in both directions", () => {
    const s = snapshot(
      ["core:hidden", { type: "everyone" }, N.cat.id],
      ["core:reader", { type: "everyone" }, N.sub.id],
    );
    expect(can(s, GUEST, "node.read", N.forum)).toBe(false);
    expect(can(s, GUEST, "node.read", N.sub)).toBe(true);
  });

  it("deny beats allow at equal specificity", () => {
    const s = snapshot(
      ["core:reader", { type: "group", id: 7 }, null],
      ["core:hidden", { type: "group", id: 8 }, null],
    );
    expect(can(s, user(10, 7, 8), "node.read", N.forum)).toBe(false);
    expect(can(s, user(10, 7), "node.read", N.forum)).toBe(true);
  });

  it("a user grant beats a group deny at the same scope", () => {
    const s = snapshot(
      ["core:hidden", { type: "group", id: 7 }, null],
      ["core:reader", { type: "user", id: 10 }, null],
    );
    expect(can(s, user(10, 7), "node.read", N.forum)).toBe(true);
  });

  it("never is absolute, even against nearer allows and user grants", () => {
    const s = snapshot(
      ...defaults,
      ["core:banned", { type: "user", id: 10 }, null],
      ["core:admin", { type: "user", id: 10 }, N.sub.id],
    );
    expect(can(s, user(10), "node.view", N.sub)).toBe(false);
    expect(can(s, user(10), "admin.access", null)).toBe(false);
    expect(can(s, user(11), "node.view", N.sub)).toBe(true);
  });

  it("requirements are enforced: replying needs reading", () => {
    const s = snapshot(...defaults, ["core:no-read", { type: "everyone" }, N.forum.id]);
    expect(can(s, user(10), "node.view", N.forum)).toBe(true);
    expect(can(s, user(10), "node.read", N.forum)).toBe(false);
    const d = permissionsFor(registry, s, user(10)).decide("topic.reply", N.forum);
    expect(d.allowed).toBe(false);
    expect(d.failedRequirement?.capability).toBe("node.read");
  });

  it("read-only roles deny posting via prefix wildcards", () => {
    const s = snapshot(...defaults, ["core:read-only", { type: "registered" }, N.forum.id]);
    expect(can(s, user(10), "node.read", N.forum)).toBe(true);
    expect(can(s, user(10), "topic.create", N.forum)).toBe(false);
    expect(can(s, user(10), "poll.vote", N.forum)).toBe(false);
  });

  it("global capabilities ignore node grants", () => {
    const s = snapshot(["core:admin", { type: "user", id: 1 }, N.forum.id]);
    expect(can(s, user(1), "admin.access", N.forum)).toBe(false);
    expect(can(snapshot(["core:admin", { type: "user", id: 1 }, null]), user(1), "admin.users", null)).toBe(
      true,
    );
  });

  it("explains its decisions", () => {
    const s = snapshot(...defaults, ["core:hidden", { type: "everyone" }, N.forum.id]);
    const text = explain(evaluate(registry, s, GUEST, "topic.reply", N.forum.id, N.forum.path));
    expect(text).toContain("topic.reply at node 2: DENIED");
    expect(text).toContain("because it requires");
    expect(text).toContain("role core:hidden (node.view = deny) for everyone, node 2");
  });

  it("matches role entries exactly, then by longest prefix, then *", () => {
    const r = {
      capabilities: { "*": "allow", "moderate.*": "deny", "moderate.lock": "never" } as Record<
        string,
        Effect
      >,
    };
    expect(roleEffect(r, "moderate.lock")).toEqual({ effect: "never", matched: "moderate.lock" });
    expect(roleEffect(r, "moderate.move")).toEqual({ effect: "deny", matched: "moderate.*" });
    expect(roleEffect(r, "node.view")).toEqual({ effect: "allow", matched: "*" });
    expect(roleEffect({ capabilities: {} }, "node.view")).toBeNull();
  });

  it("validates capability definitions and roles", () => {
    expect(() => new CapabilityRegistry().define({ key: "Bad", scope: "node", description: "" })).toThrow();
    expect(() =>
      new CapabilityRegistry().define({ key: "a.b", scope: "node", requires: ["a.c"], description: "" }),
    ).toThrow();
    expect(
      registry.validateRole({ "node.view": "allow", "moderate.*": "allow", "*": "deny", "nope.x": "allow" }),
    ).toEqual(["nope.x"]);
    for (const r of BUILTIN_ROLES) expect(registry.validateRole(r.capabilities)).toEqual([]);
  });
});

// A deliberately naive restatement of ADR 0015, checked against the engine on random boards.
function reference(
  s: PermissionSnapshot,
  v: Viewer,
  cap: string,
  node: { id: Id; path: string } | null,
): boolean {
  const def = registry.get(cap)!;
  if ((def.requires ?? []).some((r) => !reference(s, v, r, node))) return false;
  const ancestry = def.scope === "global" || !node ? [] : node.path.split("/").filter(Boolean).map(Number);
  const distance = (g: Grant) =>
    g.nodeId === null ? ancestry.length : ancestry.length - 1 - ancestry.indexOf(g.nodeId);
  const rank = { user: 4, group: 3, registered: 2, guests: 2, everyone: 1 } as const;
  const applies = (sub: Subject) =>
    sub.type === "everyone" ||
    (sub.type === "guests" && v.userId === null) ||
    (sub.type === "registered" && v.userId !== null) ||
    (sub.type === "group" && v.groupIds.includes(sub.id)) ||
    (sub.type === "user" && sub.id === v.userId);
  const effectOf = (r: Role): Effect | undefined => {
    if (r.capabilities[cap]) return r.capabilities[cap];
    const prefixes = Object.keys(r.capabilities)
      .filter((k) => k.endsWith(".*") && cap.startsWith(k.slice(0, -1)))
      .sort((a, b) => b.length - a.length);
    return prefixes.length ? r.capabilities[prefixes[0]!] : r.capabilities["*"];
  };
  const hits = s.grants
    .filter((g) => (g.nodeId === null || ancestry.includes(g.nodeId)) && applies(g.subject))
    .map((g) => ({ g, effect: effectOf(s.roles.get(g.roleId)!) }))
    .filter((h): h is { g: Grant; effect: Effect } => h.effect !== undefined);
  if (hits.some((h) => h.effect === "never")) return false;
  if (!hits.length) return false;
  const nearest = Math.min(...hits.map((h) => distance(h.g)));
  const atNearest = hits.filter((h) => distance(h.g) === nearest);
  const top = Math.max(...atNearest.map((h) => rank[h.g.subject.type]));
  return !atNearest.some((h) => rank[h.g.subject.type] === top && h.effect === "deny");
}

describe("permission engine vs. reference model", () => {
  it("agrees on 3000 random boards", () => {
    let seed = 0x5eed;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const pick = <T>(xs: readonly T[]) => xs[rnd(xs.length)]!;
    const nodes = Object.values(N);
    const subjects: Subject[] = [
      { type: "everyone" },
      { type: "guests" },
      { type: "registered" },
      { type: "group", id: 7 },
      { type: "group", id: 8 },
      { type: "user", id: 10 },
    ];
    const viewers = [GUEST, user(10), user(10, 7), user(11, 7, 8), user(12, 8)];
    const caps = registry.all().map((c) => c.key);
    for (let i = 0; i < 3000; i++) {
      const s = snapshot(
        ...Array.from({ length: rnd(6) }, (): [string, Subject, Id | null] => [
          pick(BUILTIN_ROLES).key,
          pick(subjects),
          rnd(3) ? pick(nodes).id : null,
        ]),
      );
      const v = pick(viewers);
      const cap = pick(caps);
      const node = rnd(5) ? pick(nodes) : null;
      expect(evaluate(registry, s, v, cap, node?.id ?? null, node?.path ?? null).allowed, `case ${i}`).toBe(
        reference(s, v, cap, node),
      );
    }
  });
});
