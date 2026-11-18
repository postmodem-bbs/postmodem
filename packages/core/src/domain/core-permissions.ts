// SPDX-License-Identifier: AGPL-3.0-or-later
// Core capabilities, built-in roles and the per-request permission service (ADR 0015).
import {
  type CapabilityDef,
  CapabilityRegistry,
  type Decision,
  evaluate,
  explain,
  type PermissionSnapshot,
  type Viewer,
} from "./permissions.ts";
import type { Repositories } from "./ports.ts";
import type { Effect, Id, Node } from "./types.ts";

const readable = ["node.read"];

/** phpBB2's auth_* columns, as namespaced capabilities. */
export const CORE_CAPABILITIES = [
  { key: "node.view", scope: "node", description: "See the forum in lists (auth_view)" },
  {
    key: "node.read",
    scope: "node",
    requires: ["node.view"],
    description: "Read topics and posts (auth_read)",
  },
  { key: "topic.create", scope: "node", requires: readable, description: "Start topics (auth_post)" },
  { key: "topic.reply", scope: "node", requires: readable, description: "Reply to topics (auth_reply)" },
  {
    key: "topic.sticky",
    scope: "node",
    requires: ["topic.create"],
    description: "Post sticky topics (auth_sticky)",
  },
  {
    key: "topic.announce",
    scope: "node",
    requires: ["topic.create"],
    description: "Post announcements (auth_announce)",
  },
  { key: "post.edit.own", scope: "node", requires: readable, description: "Edit own posts (auth_edit)" },
  {
    key: "post.delete.own",
    scope: "node",
    requires: readable,
    description: "Delete own posts (auth_delete)",
  },
  { key: "poll.vote", scope: "node", requires: readable, description: "Vote in polls (auth_vote)" },
  {
    key: "poll.create",
    scope: "node",
    requires: ["topic.create"],
    description: "Create polls (auth_pollcreate)",
  },
  { key: "moderate.edit", scope: "node", requires: readable, description: "Edit anyone's posts" },
  { key: "moderate.delete", scope: "node", requires: readable, description: "Delete anyone's posts" },
  { key: "moderate.lock", scope: "node", requires: readable, description: "Lock and unlock topics" },
  { key: "moderate.move", scope: "node", requires: readable, description: "Move topics" },
  { key: "moderate.split", scope: "node", requires: readable, description: "Split and merge topics" },
  { key: "moderate.ip", scope: "node", requires: readable, description: "See posters' IP addresses" },
  { key: "pm.send", scope: "global", description: "Send private messages" },
  { key: "admin.access", scope: "global", description: "Open the admin panel" },
  { key: "admin.config", scope: "global", requires: ["admin.access"], description: "Change board settings" },
  {
    key: "admin.forums",
    scope: "global",
    requires: ["admin.access"],
    description: "Manage forums and categories",
  },
  { key: "admin.users", scope: "global", requires: ["admin.access"], description: "Manage users and groups" },
  {
    key: "admin.permissions",
    scope: "global",
    requires: ["admin.access"],
    description: "Manage roles and grants",
  },
  {
    key: "admin.packages",
    scope: "global",
    requires: ["admin.access"],
    description: "Install and configure packages",
  },
] as const satisfies readonly CapabilityDef[];

export type CoreCapability = (typeof CORE_CAPABILITIES)[number]["key"];

/** Core capabilities plus those of installed packages (registry, extension point #7). */
export function coreRegistry(extra: CapabilityDef[] = []): CapabilityRegistry {
  return new CapabilityRegistry().define(
    ...CORE_CAPABILITIES.map(
      (c): CapabilityDef => ({ ...c, requires: "requires" in c ? [...c.requires] : undefined }),
    ),
    ...extra.map(({ key, scope, description, requires }) => ({ key, scope, description, requires })),
  );
}

const participate: Record<string, Effect> = {
  "node.view": "allow",
  "node.read": "allow",
  "topic.create": "allow",
  "topic.reply": "allow",
  "post.edit.own": "allow",
  "post.delete.own": "allow",
  "poll.vote": "allow",
  "poll.create": "allow",
  "pm.send": "allow",
};

/** Built-in roles, (re)installed on every start so upgrades can extend them. */
export const BUILTIN_ROLES: { key: string; name: string; capabilities: Record<string, Effect> }[] = [
  { key: "core:reader", name: "Reader", capabilities: { "node.view": "allow", "node.read": "allow" } },
  { key: "core:participant", name: "Participant", capabilities: participate },
  {
    key: "core:moderator",
    name: "Moderator",
    capabilities: {
      ...participate,
      "topic.sticky": "allow",
      "topic.announce": "allow",
      "moderate.*": "allow",
    },
  },
  { key: "core:admin", name: "Administrator", capabilities: { "*": "allow" } },
  { key: "core:hidden", name: "Hidden", capabilities: { "node.view": "deny", "node.read": "deny" } },
  {
    key: "core:read-only",
    name: "Read only",
    capabilities: {
      "node.view": "allow",
      "node.read": "allow",
      "topic.*": "deny",
      "post.*": "deny",
      "poll.*": "deny",
    },
  },
  {
    key: "core:no-read",
    name: "Listed, not readable",
    capabilities: { "node.view": "allow", "node.read": "deny" },
  },
  { key: "core:banned", name: "Banned", capabilities: { "*": "never" } },
];

/**
 * Installs the built-in roles and, on a board with no grants at all, phpBB2's defaults:
 * everyone may read, registered users may post. Idempotent.
 */
export async function installCorePermissions(
  repos: Repositories,
  packages: { capabilities: CapabilityDef[]; roleGrants: Record<string, Record<string, Effect>> } = {
    capabilities: [],
    roleGrants: {},
  },
): Promise<{ defaultGrants: boolean }> {
  const registry = coreRegistry(packages.capabilities);
  const roles = new Map<string, Id>();
  for (const r of BUILTIN_ROLES) {
    // Packages extend the built-in roles (e.g. members may report posts); the core's own
    // entries win, so a package can't widen what a role means for core capabilities.
    const capabilities = { ...packages.roleGrants[r.key], ...r.capabilities };
    const unknown = registry.validateRole(capabilities);
    if (unknown.length) throw new Error(`role ${r.key} uses unknown capabilities: ${unknown.join(", ")}`);
    roles.set(r.key, (await repos.roles.upsert({ ...r, capabilities, builtin: true })).id);
  }
  if ((await repos.grants.all()).length) return { defaultGrants: false };
  await repos.grants.create(roles.get("core:reader")!, { type: "everyone" }, null);
  await repos.grants.create(roles.get("core:participant")!, { type: "registered" }, null);
  return { defaultGrants: true };
}

/** Per-request view of the permission model: one snapshot, many cheap decisions. */
export interface Permissions {
  readonly viewer: Viewer;
  decide(capability: string, node: Pick<Node, "id" | "path"> | null): Decision;
  can(capability: string, node: Pick<Node, "id" | "path"> | null): boolean;
  /** Keeps the nodes where the capability is allowed. */
  filter<T extends Pick<Node, "id" | "path">>(capability: string, nodes: T[]): T[];
  explain(capability: string, node: Pick<Node, "id" | "path"> | null): string;
}

export function permissionsFor(
  registry: CapabilityRegistry,
  snapshot: PermissionSnapshot,
  viewer: Viewer,
): Permissions {
  const cache = new Map<string, Decision>();
  const decide = (capability: string, node: Pick<Node, "id" | "path"> | null) => {
    const key = `${capability}@${node?.id ?? ""}`;
    let d = cache.get(key);
    if (!d) {
      d = evaluate(registry, snapshot, viewer, capability, node?.id ?? null, node?.path ?? null);
      cache.set(key, d);
    }
    return d;
  };
  return {
    viewer,
    decide,
    can: (c, n) => decide(c, n).allowed,
    filter: (c, nodes) => nodes.filter((n) => decide(c, n).allowed),
    explain: (c, n) => explain(decide(c, n)),
  };
}

export async function loadSnapshot(repos: Repositories): Promise<PermissionSnapshot> {
  const [grants, roles] = await Promise.all([repos.grants.all(), repos.roles.all()]);
  return { grants, roles: new Map(roles.map((r) => [r.id, r])) };
}

export async function viewerFor(repos: Repositories, userId: Id | null): Promise<Viewer> {
  return userId === null
    ? { userId: null, groupIds: [] }
    : { userId, groupIds: await repos.groups.groupsOf(userId) };
}
