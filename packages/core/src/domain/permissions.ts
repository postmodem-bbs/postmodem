// SPDX-License-Identifier: AGPL-3.0-or-later
// Permission engine (DESIGN §5.3, EXTENSION-POINTS §4, ADR 0015).
//
// A grant gives a role (a set of capability effects) to a subject, board-wide or on a node and
// its subtree. Resolving capability C for a viewer at node N:
//   1. `never` anywhere in N's ancestry or board-wide, for any matching subject → denied.
//   2. Otherwise the NEAREST scope (N, its parent, …, board) where any matching grant mentions C
//      decides.
//   3. Within that scope the MOST SPECIFIC subject decides (user > group > registered/guests >
//      everyone); at equal specificity deny beats allow.
//   4. Nothing said anywhere → denied.
// Capabilities may require others (topic.reply requires node.read), checked the same way.
// Every decision carries the reasons behind it.
import { idsOf } from "./tree.ts";
import type { Effect, Grant, Id, Role, Subject } from "./types.ts";

export interface Viewer {
  /** null for guests. */
  userId: Id | null;
  /** Approved group memberships. */
  groupIds: Id[];
}
export const GUEST: Viewer = { userId: null, groupIds: [] };

export interface CapabilityDef {
  /** Namespaced key, e.g. "topic.reply" (core) or "shoutbox.post" (a package). */
  key: string;
  /** "node": meaningful per forum; "global": board-wide only (admin pages, profiles). */
  scope: "node" | "global";
  /** Capabilities that must also be allowed, at the same node. */
  requires?: string[];
  description: string;
}

export class CapabilityRegistry {
  readonly #defs = new Map<string, CapabilityDef>();
  define(...defs: CapabilityDef[]): this {
    for (const d of defs) {
      if (!/^[a-z][a-z0-9-]*(\.[a-z][a-zA-Z0-9-]*)+$/.test(d.key))
        throw new Error(`invalid capability key '${d.key}'`);
      if (this.#defs.has(d.key)) throw new Error(`capability '${d.key}' is already defined`);
      this.#defs.set(d.key, d);
    }
    for (const d of defs)
      for (const r of d.requires ?? [])
        if (!this.#defs.has(r)) throw new Error(`'${d.key}' requires unknown '${r}'`);
    return this;
  }
  get(key: string): CapabilityDef | undefined {
    return this.#defs.get(key);
  }
  all(): CapabilityDef[] {
    return [...this.#defs.values()];
  }
  /** Validates a role's capability keys: known keys, "*" or "prefix.*". */
  validateRole(capabilities: Record<string, Effect>): string[] {
    return Object.keys(capabilities).filter((k) => {
      if (k === "*") return false;
      if (k.endsWith(".*")) return !this.all().some((d) => d.key.startsWith(k.slice(0, -1)));
      return !this.#defs.has(k);
    });
  }
}

export interface Reason {
  grantId: Id;
  roleKey: string;
  subject: Subject;
  /** Node the grant is scoped to, or null for board-wide. */
  scopeNodeId: Id | null;
  /** The role entry that matched: exact key, "prefix.*" or "*". */
  matched: string;
  effect: Effect;
}

export interface Decision {
  capability: string;
  nodeId: Id | null;
  allowed: boolean;
  /** never | deny | allow from a decisive grant, or "unset" when nothing applied. */
  effect: Effect | "unset";
  /** The grants that decided (all matching ones at the deciding level). */
  reasons: Reason[];
  /** Scope that decided (null = board-wide); undefined when unset or decided by `never`. */
  decidedAt?: Id | null;
  /** A required capability that was denied, with its own decision. */
  failedRequirement?: Decision;
}

const SPECIFICITY: Record<Subject["type"], number> = {
  user: 4,
  group: 3,
  registered: 2,
  guests: 2,
  everyone: 1,
};

export function subjectMatches(s: Subject, v: Viewer): boolean {
  switch (s.type) {
    case "everyone":
      return true;
    case "guests":
      return v.userId === null;
    case "registered":
      return v.userId !== null;
    case "group":
      return v.groupIds.includes(s.id);
    case "user":
      return v.userId === s.id;
  }
}

/** A role's effect for a capability: exact entry, else the longest matching "prefix.*", else "*". */
export function roleEffect(
  role: Pick<Role, "capabilities">,
  capability: string,
): { effect: Effect; matched: string } | null {
  const exact = role.capabilities[capability];
  if (exact) return { effect: exact, matched: capability };
  let best: { effect: Effect; matched: string } | null = null;
  for (const [key, effect] of Object.entries(role.capabilities)) {
    if (
      key.endsWith(".*") &&
      capability.startsWith(key.slice(0, -1)) &&
      (!best || key.length > best.matched.length)
    ) {
      best = { effect, matched: key };
    }
  }
  if (best) return best;
  const any = role.capabilities["*"];
  return any ? { effect: any, matched: "*" } : null;
}

/** Everything needed to decide, loaded once per request. */
export interface PermissionSnapshot {
  grants: Grant[];
  roles: Map<Id, Role>;
}

/**
 * Pure resolution of one capability. `path` is the node's materialised path ("/1/7/12/") or
 * null for a board-wide question.
 */
export function evaluate(
  registry: CapabilityRegistry,
  snapshot: PermissionSnapshot,
  viewer: Viewer,
  capability: string,
  nodeId: Id | null,
  path: string | null,
): Decision {
  const def = registry.get(capability);
  if (!def) throw new Error(`unknown capability '${capability}'`);

  // Requirements first: a denied requirement denies, and says why.
  for (const req of def.requires ?? []) {
    const r = evaluate(registry, snapshot, viewer, req, nodeId, path);
    if (!r.allowed)
      return {
        capability,
        nodeId,
        allowed: false,
        effect: r.effect,
        reasons: r.reasons,
        failedRequirement: r,
      };
  }

  // Scopes from nearest to farthest; board-wide (null) last.
  const chain: (Id | null)[] =
    def.scope === "global" || path === null ? [null] : [...idsOf(path).reverse(), null];
  const atScope = new Map<Id | null, Reason[]>();
  for (const grant of snapshot.grants) {
    if (!chain.includes(grant.nodeId) || !subjectMatches(grant.subject, viewer)) continue;
    const role = snapshot.roles.get(grant.roleId);
    const hit = role && roleEffect(role, capability);
    if (!hit) continue;
    const reason: Reason = {
      grantId: grant.id,
      roleKey: role.key,
      subject: grant.subject,
      scopeNodeId: grant.nodeId,
      ...hit,
    };
    const list = atScope.get(grant.nodeId) ?? [];
    list.push(reason);
    atScope.set(grant.nodeId, list);
  }

  const nevers = [...atScope.values()].flat().filter((r) => r.effect === "never");
  if (nevers.length) return { capability, nodeId, allowed: false, effect: "never", reasons: nevers };

  for (const scope of chain) {
    const reasons = atScope.get(scope);
    if (!reasons?.length) continue;
    const top = Math.max(...reasons.map((r) => SPECIFICITY[r.subject.type]));
    const decisive = reasons.filter((r) => SPECIFICITY[r.subject.type] === top);
    const denied = decisive.filter((r) => r.effect === "deny");
    const chosen = denied.length ? denied : decisive;
    return {
      capability,
      nodeId,
      allowed: !denied.length,
      effect: denied.length ? "deny" : "allow",
      reasons: chosen,
      decidedAt: scope,
    };
  }
  return { capability, nodeId, allowed: false, effect: "unset", reasons: [] };
}

/** Human-readable explanation, for `postmodem perms explain` and the future simulator. */
export function explain(d: Decision, indent = ""): string {
  const subject = (s: Subject) => ("id" in s ? `${s.type} ${s.id}` : s.type);
  const where = (n: Id | null) => (n === null ? "board-wide" : `node ${n}`);
  const head = `${indent}${d.capability} at ${where(d.nodeId)}: ${d.allowed ? "ALLOWED" : "DENIED"} (${d.effect})`;
  if (d.failedRequirement)
    return `${head}\n${indent}  because it requires:\n${explain(d.failedRequirement, `${indent}    `)}`;
  if (!d.reasons.length) return `${head}\n${indent}  no grant mentions this capability for this viewer`;
  const lines = d.reasons.map(
    (r) =>
      `${indent}  - grant #${r.grantId}: role ${r.roleKey} (${r.matched} = ${r.effect}) for ${subject(r.subject)}, ${where(r.scopeNodeId)}`,
  );
  return [head, ...lines].join("\n");
}
