// SPDX-License-Identifier: AGPL-3.0-or-later
// Core domain entities (DESIGN.md §5.2, M1 slice 1). Plain data; no persistence concerns.
// Timestamps are epoch milliseconds; ids are positive integers (imported content keeps legacy ids).

export type Id = number;
export type Millis = number;

/** Registered visibility states (EXTENSION-POINTS §2.1). Packages add their own, namespaced. */
export type VisibilityState = "core:public" | "core:deleted" | (string & {});

export type NodeKind = "category" | "forum" | "link";

export interface Node {
  id: Id;
  parentId: Id | null;
  /** Materialised path of ids, e.g. "/1/7/12/". Root-level nodes: "/<id>/". */
  path: string;
  depth: number;
  position: number;
  kind: NodeKind;
  title: string;
  slug: string;
  description: string;
  linkUrl: string | null;
  locked: boolean;
  topicCount: number;
  postCount: number;
  lastPostId: Id | null;
  visibility: VisibilityState;
  createdAt: Millis;
  updatedAt: Millis;
}

export type TopicType = "normal" | "sticky" | "announcement" | (string & {});

export interface Topic {
  id: Id;
  nodeId: Id;
  title: string;
  slug: string;
  authorId: Id | null;
  /** Shown when there's no author account: guests, deleted users, remote fallbacks. */
  authorName: string;
  type: TopicType;
  locked: boolean;
  movedToTopicId: Id | null;
  replyCount: number;
  viewCount: number;
  firstPostId: Id | null;
  lastPostId: Id | null;
  lastPostAt: Millis | null;
  visibility: VisibilityState;
  createdAt: Millis;
  updatedAt: Millis;
}

/**
 * How a post's source is written. `bbcode-phpbb2` is Postmodem's BBCode dialect (phpBB2's tags
 * plus Przemo's, without uids or HTML escaping: @postmodem/markup converts legacy storage on import).
 * `html-remote` is sanitised federated content (ADR 0009).
 */
export type MarkupFormat = "bbcode-phpbb2" | "markdown" | "html-remote" | (string & {});

export interface Post {
  id: Id;
  topicId: Id;
  nodeId: Id;
  authorId: Id | null;
  authorName: string;
  /** phpBB2's optional per-post subject (plain text); empty when the post has none. */
  subject: string;
  source: string;
  format: MarkupFormat;
  /** Cached HTML; null until rendered. Valid while renderVersion matches the renderer's. */
  rendered: string | null;
  renderVersion: number;
  visibility: VisibilityState;
  createdAt: Millis;
  editedAt: Millis | null;
  editCount: number;
}

export type UserStatus = "pending" | "active" | "banned" | "deleted";

export interface User {
  id: Id;
  username: string;
  /** Normalised username for uniqueness (see username.ts). */
  usernameKey: string;
  /** URL slug (ADR 0012), unique; old ones stay in slug_history after a rename. */
  slug: string;
  email: string | null;
  /** "local" or the remote host for federated actors (ADR 0009). */
  origin: string;
  status: UserStatus;
  createdAt: Millis;
  lastSeenAt: Millis | null;
  postCount: number;
  rankId: Id | null;
  signatureSource: string;
  signatureFormat: MarkupFormat;
  avatar: string | null;
  location: string;
  website: string;
  locale: string | null;
  timezone: string | null;
  /** Version of the board rules the user accepted, and when (null: never, e.g. imported). */
  rulesVersion: number | null;
  rulesAcceptedAt: Millis | null;
  /** E-mail when a private message arrives (phpBB2 user_notify_pm). */
  notifyPm: boolean;
  /** Watch topics one starts or replies to (phpBB2 user_notify), for reply e-mails. */
  autoWatch: boolean;
}

/** A signed-in browser. The id is a hash of the cookie value; the cookie itself is never stored. */
export interface Session {
  id: string;
  userId: Id;
  createdAt: Millis;
  lastSeenAt: Millis;
  expiresAt: Millis;
  userAgent: string;
  ip: string;
}

export type JobStatus = "queued" | "running" | "done" | "failed";

/** A unit of background work (job queue v0, CONTAINERS.md §2). Payloads are JSON. */
export interface Job {
  id: Id;
  type: string;
  payload: unknown;
  status: JobStatus;
  runAt: Millis;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
  lockedUntil: Millis | null;
  lastError: string;
  createdAt: Millis;
  finishedAt: Millis | null;
}

export type EmailTokenPurpose = "verify-email" | "reset-password";

export type GroupKind = "open" | "closed" | "hidden" | "system";

export interface Group {
  id: Id;
  name: string;
  nameKey: string;
  description: string;
  kind: GroupKind;
  createdAt: Millis;
}

export interface Membership {
  groupId: Id;
  userId: Id;
  role: "member" | "moderator";
  pending: boolean;
}

export type Effect = "allow" | "deny" | "never";

export interface Role {
  id: Id;
  /** Namespaced, e.g. "core:registered". */
  key: string;
  name: string;
  builtin: boolean;
  capabilities: Record<string, Effect>;
}

/** Who a grant applies to. Built-in audiences avoid materialising "everyone" groups. */
export type Subject =
  | { type: "everyone" }
  | { type: "guests" }
  | { type: "registered" }
  | { type: "group"; id: Id }
  | { type: "user"; id: Id };

export interface Grant {
  id: Id;
  roleId: Id;
  subject: Subject;
  /** null = whole board; otherwise the node and its subtree. */
  nodeId: Id | null;
  createdAt: Millis;
}

export interface Rank {
  id: Id;
  title: string;
  minPosts: number | null;
  special: boolean;
  image: string | null;
}

export interface Smiley {
  id: Id;
  code: string;
  image: string;
  emotion: string;
  position: number;
}

/** phpBB2's topic poll (vote_desc / vote_results / vote_voters). Voting itself arrives in M2. */
export interface Poll {
  id: Id;
  topicId: Id;
  question: string;
  startsAt: Millis;
  /** null: runs forever (phpBB2 vote_length 0). */
  endsAt: Millis | null;
  /** Counts stay hidden until the poll ends (Przemo's vote_hide; read so imports don't leak them). */
  hideResults: boolean;
  options: { position: number; text: string; votes: number }[];
  voterCount: number;
}

/** phpBB2's banlist: a user, an IP address (with * wildcards, e.g. 192.168.*) or an e-mail address (*@spam.example). */
export interface Ban {
  id: Id;
  kind: "user" | "ip" | "email";
  value: string;
  reason: string;
  createdBy: Id | null;
  createdAt: Millis;
  expiresAt: Millis | null;
}

/** phpBB2's privmsgs: one row per message; each side can delete its own view of it. */
export interface PrivateMessage {
  id: Id;
  /** null: sent by the board itself. */
  senderId: Id | null;
  recipientId: Id;
  subject: string;
  source: string;
  createdAt: Millis;
  readAt: Millis | null;
  senderDeleted: boolean;
  recipientDeleted: boolean;
}

export interface AuditEntry {
  id: Id;
  at: Millis;
  actorId: Id | null;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
}
