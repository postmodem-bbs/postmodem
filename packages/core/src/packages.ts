// SPDX-License-Identifier: AGPL-3.0-or-later
// The package runtime, v0 (M2 slice 3; PACKAGES.md, ADR 0003, ADR 0019). A package declares
// what it adds (capabilities with default role grants, settings, migrations) and, when set
// up, how it takes part (events, listing decorations, slots). Packages are installed with
// the image; which ones are *enabled* is a board setting, read on every call, so enabling or
// disabling one applies to a running board within seconds. This is the first-party API: the
// SDK that third parties build on is frozen in M4, shaped by these packages.

import type { Permissions } from "./domain/core-permissions.ts";
import type { CapabilityDef, Viewer } from "./domain/permissions.ts";
import type { Repositories } from "./domain/ports.ts";
import type { Effect, Id, Node, Post, Session, Topic, User } from "./domain/types.ts";
import type { Logger } from "./log.ts";
import type { SettingDef, Settings } from "./settings.ts";

export type PackageKey = string;

/** Extension point #9 and the content lifecycle, as events after the fact. */
export interface BoardEvents {
  "topic.created": { topic: Topic; post: Post; actor: User };
  "post.created": { topic: Topic; post: Post; actor: User };
  "post.edited": { topic: Topic; post: Post; actor: User };
  "post.deleted": { topic: Topic; post: Post; actor: User; topicDeleted: boolean };
  "topic.viewed": { topic: Topic; viewer: Viewer; lastPostAt: number | null };
  "moderation.action": { action: string; topicId: Id; actor: User; reason: string };
}
export type BoardEvent = keyof BoardEvents;

/** Extension point #2: what a package adds to a row of a topic or forum list. */
export interface Decoration {
  /** Small labels next to the title; `label` is a message id. */
  badges?: { key: string; label: string }[];
  /** CSS classes on the row, from the package's namespace (e.g. `pm-unread`). */
  classes?: string[];
}

/**
 * Slots: places in the core pages where packages add something. Contributions are data, not
 * markup (the core renders them), so a package can't break a page's accessibility or CSP.
 */
export type SlotName = "topic.afterPosts" | "post.actions" | "header.badges" | "forum.tools";
export type SlotItem =
  | { kind: "link"; key: string; label: string; href: string; count?: number }
  | {
      kind: "form";
      key: string;
      heading: string;
      action: string;
      fields: {
        name: string;
        label: string;
        type: "textarea" | "text" | "hidden";
        value?: string;
        required?: boolean;
      }[];
      submit: string;
    };
export interface SlotArgs {
  viewer: Viewer;
  perms: Permissions;
  user: User | null;
  topic?: Topic;
  node?: Node;
  post?: Post;
}

export interface PackageContext {
  repos: Repositories;
  /** The query builder (Kysely, snake_case), for the package's own tables. Typed by the package. */
  db: unknown;
  settings: Settings;
  log: Logger;
  isEnabled(key: PackageKey): boolean;
}

export interface LoginAttempt {
  /** Normalized identifier, including when there is no matching account. */
  identifier: string;
  ip: string;
  now: number;
}

export type PackagePasswordPolicy = (
  password: string,
  user: Pick<User, "username" | "email">,
) => string | undefined;

export interface PackageAuth {
  /** Milliseconds to wait before retrying. */
  beforeLogin?(attempt: LoginAttempt): Promise<number> | number;
  afterLoginFailure?(attempt: LoginAttempt): Promise<void> | void;
  afterLoginSuccess?(attempt: LoginAttempt): Promise<void> | void;
  passwordPolicy?: PackagePasswordPolicy;
  /** Synchronous check over the existing session and request metadata. */
  validateSession?(session: Session, ip: string): boolean;
}

export interface PackageRuntime {
  auth?: PackageAuth;
  on?: { [E in BoardEvent]?: (event: BoardEvents[E]) => Promise<void> | void };
  decorateTopics?(viewer: Viewer, topics: Topic[]): Promise<Map<Id, Decoration>>;
  decorateForums?(viewer: Viewer, nodes: Node[]): Promise<Map<Id, Decoration>>;
  slots?: { [S in SlotName]?: (args: SlotArgs) => Promise<SlotItem[]> | SlotItem[] };
}

export interface PackageDefinition {
  /** kebab-case, matching PACKAGES.md (e.g. `unread-tracking`). */
  key: PackageKey;
  name: string;
  description: string;
  /** PACKAGES.md: 1 add-on, 2 module. */
  tier: 1 | 2;
  version: string;
  /** Capabilities with their default effect per built-in role (merged into those roles). */
  capabilities?: (CapabilityDef & { roles?: Record<string, Effect> })[];
  settings?: SettingDef<unknown>[];
  /**
   * Kysely migrations (real snake_case names, table names prefixed `pm_`), run for every
   * installed package, enabled or not, so enabling one later needs no migration step.
   */
  migrations?(dialect: "sqlite" | "pg"): Record<string, { up(db: never): Promise<void> }>;
  setup?(ctx: PackageContext): PackageRuntime | Promise<PackageRuntime>;
}

/** Distribution profiles (PACKAGES.md §5, ADR 0019). */
export const PROFILES = {
  vanilla: [] as PackageKey[],
  essentials: ["quick-reply", "reports", "unread-tracking", "login-security"] as PackageKey[],
  przemo: ["quick-reply", "reports", "unread-tracking", "login-security"] as PackageKey[],
} as const;
export type ProfileName = keyof typeof PROFILES;

/** The enabled set: the board setting when set, else the profile's list; unknown keys dropped. */
export function enabledPackages(
  installed: PackageDefinition[],
  setting: PackageKey[] | null,
  profile: ProfileName,
): Set<PackageKey> {
  const known = new Set(installed.map((p) => p.key));
  return new Set((setting ?? PROFILES[profile]).filter((k) => known.has(k)));
}

/** Capability grants packages add to the built-in roles, by role key. */
export function packageRoleGrants(installed: PackageDefinition[]): Record<string, Record<string, Effect>> {
  const out: Record<string, Record<string, Effect>> = {};
  for (const p of installed)
    for (const c of p.capabilities ?? [])
      for (const [role, effect] of Object.entries(c.roles ?? {})) {
        out[role] ??= {};
        out[role][c.key] = effect;
      }
  return out;
}
