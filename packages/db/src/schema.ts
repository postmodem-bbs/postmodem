// SPDX-License-Identifier: AGPL-3.0-or-later
// Table types for Kysely. Columns are snake_case in the database and camelCase here
// (CamelCasePlugin). Keep in lockstep with migrations.ts.
// Portability conventions (ADR 0013): timestamps are epoch milliseconds (bigint),
// flags are 0/1 integers, JSON is stored as text (SQLite) or jsonb (Postgres, settings only).
import type { Generated } from "kysely";

type Bool = number; // 0 | 1

export interface SettingsTable {
  key: string;
  value: unknown;
  updatedAt: unknown;
}

export interface NodesTable {
  id: Generated<number>;
  parentId: number | null;
  path: string;
  depth: number;
  position: number;
  kind: string;
  title: string;
  slug: string;
  description: string;
  linkUrl: string | null;
  locked: Bool;
  topicCount: number;
  postCount: number;
  lastPostId: number | null;
  visibility: string;
  createdAt: number;
  updatedAt: number;
}

export interface UsersTable {
  id: Generated<number>;
  username: string;
  usernameKey: string;
  usernameSkeleton: string;
  slug: string;
  email: string | null;
  emailKey: string | null;
  origin: string;
  status: string;
  createdAt: number;
  lastSeenAt: number | null;
  postCount: number;
  rankId: number | null;
  signatureSource: string;
  signatureFormat: string;
  avatar: string | null;
  location: string;
  website: string;
  locale: string | null;
  timezone: string | null;
  rulesVersion: number | null;
  rulesAcceptedAt: number | null;
  notifyPm: Bool;
  autoWatch: Bool;
}

export interface CredentialsTable {
  userId: number;
  scheme: string;
  hash: string;
  updatedAt: number;
}

export interface EmailTokensTable {
  id: Generated<number>;
  userId: number;
  purpose: string;
  tokenHash: string;
  targetEmail: string | null;
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
}

export interface JobsTable {
  id: Generated<number>;
  type: string;
  payload: string; // JSON text, identical on both engines
  status: string;
  runAt: number;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
  lockedUntil: number | null;
  lastError: string;
  createdAt: number;
  finishedAt: number | null;
}

export interface ThrottleTable {
  key: string;
  failures: number;
  last: number;
}

export interface SessionsTable {
  id: string; // hash of the cookie value
  userId: number;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string;
  ip: string;
}

export interface GroupsTable {
  id: Generated<number>;
  name: string;
  nameKey: string;
  description: string;
  kind: string;
  createdAt: number;
}

export interface MembershipsTable {
  groupId: number;
  userId: number;
  role: string;
  pending: Bool;
}

export interface RolesTable {
  id: Generated<number>;
  key: string;
  name: string;
  builtin: Bool;
}

export interface RoleCapabilitiesTable {
  roleId: number;
  capability: string;
  effect: string;
}

export interface GrantsTable {
  id: Generated<number>;
  roleId: number;
  subjectType: string;
  subjectId: number | null;
  nodeId: number | null;
  createdAt: number;
}

export interface TopicsTable {
  id: Generated<number>;
  nodeId: number;
  title: string;
  slug: string;
  authorId: number | null;
  authorName: string;
  type: string;
  locked: Bool;
  movedToTopicId: number | null;
  replyCount: number;
  viewCount: number;
  firstPostId: number | null;
  lastPostId: number | null;
  lastPostAt: number | null;
  visibility: string;
  createdAt: number;
  updatedAt: number;
}

export interface PostsTable {
  id: Generated<number>;
  topicId: number;
  nodeId: number;
  authorId: number | null;
  authorName: string;
  subject: string;
  source: string;
  format: string;
  rendered: string | null;
  renderVersion: number;
  visibility: string;
  createdAt: number;
  editedAt: number | null;
  editCount: number;
}

export interface RanksTable {
  id: Generated<number>;
  title: string;
  minPosts: number | null;
  special: Bool;
  image: string | null;
}

export interface SmiliesTable {
  id: Generated<number>;
  code: string;
  image: string;
  emotion: string;
  position: number;
}

export interface PollsTable {
  id: Generated<number>;
  topicId: number;
  question: string;
  startsAt: number;
  endsAt: number | null;
  hideResults: Bool;
  createdAt: number;
}

export interface PollOptionsTable {
  pollId: number;
  position: number;
  text: string;
  votes: number;
}

export interface PollVotersTable {
  pollId: number;
  userId: number;
}

export interface PrivateMessagesTable {
  id: Generated<number>;
  senderId: number | null;
  recipientId: number;
  subject: string;
  source: string;
  createdAt: number;
  readAt: number | null;
  senderDeleted: Bool;
  recipientDeleted: Bool;
}

export interface TopicWatchesTable {
  userId: number;
  topicId: number;
  notified: Bool;
}

export interface SearchMetaTable {
  postId: number;
  topicId: number;
  nodeId: number;
  authorId: number | null;
  createdAt: number;
}

export interface InvitesTable {
  id: Generated<number>;
  codeHash: string;
  createdBy: number | null;
  createdAt: number;
  expiresAt: number | null;
  usesLeft: number;
  note: string;
}

export interface BansTable {
  id: Generated<number>;
  kind: string;
  value: string;
  reason: string;
  createdBy: number | null;
  createdAt: number;
  expiresAt: number | null;
}

export interface AuditLogTable {
  id: Generated<number>;
  at: number;
  actorId: number | null;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
}

export interface LegacyIdsTable {
  source: string;
  kind: string;
  legacyId: string;
  newId: number;
}

export interface SlugHistoryTable {
  kind: string;
  slug: string;
  entityId: number;
  createdAt: number;
}

export interface UserPreferencesTable {
  userId: number;
  key: string;
  value: string;
}

export interface FieldValuesTable {
  entityId: number;
  field: string;
  vText: string | null;
  vInt: number | null;
  vNum: number | null;
  vBool: number | null;
  vJson: string;
}

export interface ExtDocsTable {
  collection: string;
  id: string;
  scope: number | null;
  author: number | null;
  created: number;
  updated: number;
  state: string;
  data: string;
}

export interface ExtCountersTable {
  counter: string;
  key: string;
  period: string;
  bucket: string;
  value: Generated<number>;
}

export interface Schema {
  settings: SettingsTable;
  nodes: NodesTable;
  users: UsersTable;
  credentials: CredentialsTable;
  emailTokens: EmailTokensTable;
  jobs: JobsTable;
  throttle: ThrottleTable;
  sessions: SessionsTable;
  groups: GroupsTable;
  memberships: MembershipsTable;
  roles: RolesTable;
  roleCapabilities: RoleCapabilitiesTable;
  grants: GrantsTable;
  topics: TopicsTable;
  posts: PostsTable;
  ranks: RanksTable;
  smilies: SmiliesTable;
  polls: PollsTable;
  pollOptions: PollOptionsTable;
  pollVoters: PollVotersTable;
  bans: BansTable;
  privateMessages: PrivateMessagesTable;
  topicWatches: TopicWatchesTable;
  searchMeta: SearchMetaTable;
  invites: InvitesTable;
  auditLog: AuditLogTable;
  legacyIds: LegacyIdsTable;
  slugHistory: SlugHistoryTable;
  userPreferences: UserPreferencesTable;
  fieldValuesUser: FieldValuesTable;
  fieldValuesForum: FieldValuesTable;
  fieldValuesTopic: FieldValuesTable;
  fieldValuesPost: FieldValuesTable;
  extDocs: ExtDocsTable;
  extCounters: ExtCountersTable;
}

/** Tables whose ids may be set explicitly (legacy ids) and need sequence sync on Postgres. */
export const ID_TABLES = [
  "nodes",
  "users",
  "email_tokens",
  "groups",
  "roles",
  "grants",
  "topics",
  "posts",
  "ranks",
  "smilies",
  "audit_log",
  "polls",
  "private_messages",
] as const;
