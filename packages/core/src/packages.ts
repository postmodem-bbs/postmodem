// SPDX-License-Identifier: AGPL-3.0-or-later
// The package runtime, v0 (M2 slice 3; PACKAGES.md, ADR 0003, ADR 0019). A package declares
// what it adds (capabilities with default role grants, settings, migrations) and, when set
// up, how it takes part (events, listing decorations, slots). Packages are installed with
// the image; which ones are *enabled* is a board setting, read on every call, so enabling or
// disabling one applies to a running board within seconds. This is the first-party API: the
// SDK that third parties build on is frozen in M4, shaped by these packages.

import type { Permissions } from "./domain/core-permissions.ts";
import type { ContentHooks } from "./domain/hooks.ts";
import type { CapabilityDef, Viewer } from "./domain/permissions.ts";
import type { Repositories } from "./domain/ports.ts";
import type { Effect, Id, Millis, Node, Post, Session, Topic, User } from "./domain/types.ts";
import type { Logger } from "./log.ts";
import type { ChannelDef, Channels } from "./platform/channels.ts";
import type { CollectionDef, Collections } from "./platform/collections.ts";
import type { CounterDef, Counters } from "./platform/counters.ts";
import type { FieldDef, Fields } from "./platform/fields.ts";
import type { PreferenceDef } from "./platform/preferences.ts";
import type { SettingDef, Settings } from "./settings.ts";

export type PackageKey = string;

/** Extension point #9 and the content lifecycle, as events after the fact. */
export interface BoardEvents {
  "auth.signedIn": { actor: User; now: Millis };
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
  /** Platform services (PLATFORM-SERVICES.md): the package's own declarations live here. */
  fields: Fields;
  collections: Collections;
  channels: Channels;
  counters: Counters;
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

export interface RenderReader {
  topic: Topic;
  node: Node;
  perms: Permissions;
}

export interface RenderHole {
  tag: string;
  key: string;
  /** Evaluate reader facts once for all occurrences of the hole on the topic page. */
  reveal(reader: RenderReader): boolean | Promise<boolean>;
}

export interface RequestContext {
  via: "web" | "api" | "federation" | "cli" | "job";
  locale: string;
  timezone: string | null;
  ip?: string;
  userAgent?: string;
  sessionId?: string;
}

export type PersonalRequestField = "ip" | "userAgent" | "sessionId";

export interface PackageRuntime {
  /** EP #13: account export and erasure, including while the package is disabled. */
  privacy?: {
    export(userId: Id): Promise<unknown>;
    erase(userId: Id, tx: Repositories): Promise<void>;
  };
  renderHoles?: readonly RenderHole[];
  auth?: PackageAuth;
  /** Extension points #3 (lifecycle) and #5 (access) on the posting commands. */
  content?: ContentHooks;
  on?: {
    [E in BoardEvent]?: (event: BoardEvents[E], request?: RequestContext) => Promise<void> | void;
  };
  decorateTopics?(viewer: Viewer, topics: Topic[]): Promise<Map<Id, Decoration>>;
  decorateForums?(viewer: Viewer, nodes: Node[]): Promise<Map<Id, Decoration>>;
  slots?: { [S in SlotName]?: (args: SlotArgs) => Promise<SlotItem[]> | SlotItem[] };
  /**
   * The per-post slot for a whole page of posts at once (batch-first: one query per page,
   * not per post). Items are added after the per-post `slots["post.actions"]` ones.
   */
  postActions?(args: Omit<SlotArgs, "post">, posts: Post[]): Promise<Map<Id, SlotItem[]>>;
  /** Scheduled housekeeping (retention); returns how many rows it removed. */
  housekeeping?(now: Millis): Promise<number>;
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
  /** EP-1a private topic states: excluded from ordinary reads, counts, and search. */
  privateTopicStates?: readonly string[];
  personalData?: { purpose: string } & (
    | { reads?: never; retentionDays?: never }
    | { reads: readonly PersonalRequestField[]; retentionDays: number }
  );
  /** Platform services (M2b slice 10), keys prefixed with the package key. */
  preferences?: PreferenceDef<unknown>[];
  fields?: FieldDef<unknown>[];
  // biome-ignore lint/suspicious/noExplicitAny: each collection has its own document type
  collections?: CollectionDef<any>[];
  channels?: ChannelDef[];
  counters?: CounterDef[];
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
  essentials: [
    "quick-reply",
    "reports",
    "unread-tracking",
    "revisions",
    "edit-policy",
    "login-security",
    "hide-until-reply",
  ] as PackageKey[],
  przemo: [
    "quick-reply",
    "reports",
    "unread-tracking",
    "revisions",
    "edit-policy",
    "login-security",
    "trash-bin",
    "hide-until-reply",
    "ip-logging",
  ] as PackageKey[],
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
