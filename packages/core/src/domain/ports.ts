// SPDX-License-Identifier: AGPL-3.0-or-later
// Repository ports: what the core needs from storage. Implemented once in @postmodem/db
// for SQLite and Postgres (ADR 0013). Sessions and e-mail tokens arrive with auth (slice 4).
import type {
  AuditEntry,
  Effect,
  Grant,
  Group,
  Id,
  MarkupFormat,
  Membership,
  Millis,
  Node,
  NodeKind,
  Post,
  Rank,
  Role,
  Smiley,
  Subject,
  Topic,
  TopicType,
  User,
  UserStatus,
  VisibilityState,
} from "./types.ts";

export interface PageRequest {
  page: number; // 1-based
  perPage: number;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

/** `id` may be given to keep a legacy id (importer); otherwise it's assigned. */
type WithOptionalId<T> = Omit<T, "id"> & { id?: Id };

export interface NewNode {
  id?: Id;
  parentId: Id | null;
  kind: NodeKind;
  title: string;
  slug?: string;
  description?: string;
  linkUrl?: string | null;
  position?: number;
  locked?: boolean;
  createdAt?: Millis;
}

export interface NodeRepository {
  create(input: NewNode): Promise<Node>;
  get(id: Id): Promise<Node | undefined>;
  bySlug(slug: string): Promise<Node | undefined>;
  /** Direct children ordered by position, then id. `null` = top level. */
  children(parentId: Id | null): Promise<Node[]>;
  /** Whole tree, ordered so that every node follows its parent (depth-first by position). */
  tree(): Promise<Node[]>;
  /** Node and all descendants. */
  subtree(id: Id): Promise<Node[]>;
  /** Re-parents a node with its whole subtree; refuses cycles. */
  move(id: Id, newParentId: Id | null, position?: number): Promise<Node>;
  update(
    id: Id,
    patch: Partial<Pick<Node, "title" | "description" | "position" | "locked" | "linkUrl">>,
  ): Promise<Node>;
  /** Recomputes topic/post counts and last post from public content (fixes stale legacy counters). */
  recount(id: Id): Promise<Node>;
}

export interface NewTopic {
  id?: Id;
  nodeId: Id;
  title: string;
  slug?: string;
  authorId: Id | null;
  authorName?: string;
  type?: TopicType;
  locked?: boolean;
  movedToTopicId?: Id | null;
  viewCount?: number;
  visibility?: VisibilityState;
  createdAt?: Millis;
}

export interface TopicRepository {
  create(input: NewTopic): Promise<Topic>;
  get(id: Id): Promise<Topic | undefined>;
  bySlug(slug: string): Promise<Topic | undefined>;
  /** Announcements, then stickies, then the rest; each by most recent activity. */
  listByNode(nodeId: Id, page: PageRequest, opts?: { visibility?: VisibilityState[] }): Promise<Page<Topic>>;
  /** Recomputes reply count, first/last post and last activity from posts. */
  recount(id: Id): Promise<Topic>;
  addViews(id: Id, n: number): Promise<void>;
}

export interface NewPost {
  id?: Id;
  topicId: Id;
  authorId: Id | null;
  authorName?: string;
  source: string;
  format: MarkupFormat;
  visibility?: VisibilityState;
  createdAt?: Millis;
  editedAt?: Millis | null;
  editCount?: number;
}

export interface PostRepository {
  create(input: NewPost): Promise<Post>;
  get(id: Id): Promise<Post | undefined>;
  /** Oldest first, as a classic board reads. */
  listByTopic(topicId: Id, page: PageRequest, opts?: { visibility?: VisibilityState[] }): Promise<Page<Post>>;
  /** 0-based position of a post within its topic (for `?p=` permalinks to the right page). */
  positionInTopic(postId: Id): Promise<number | undefined>;
  setRendered(id: Id, html: string, renderVersion: number): Promise<void>;
}

export interface NewUser {
  id?: Id;
  username: string;
  email: string | null;
  origin?: string;
  status?: UserStatus;
  createdAt?: Millis;
  lastSeenAt?: Millis | null;
  postCount?: number;
  rankId?: Id | null;
  signatureSource?: string;
  signatureFormat?: MarkupFormat;
  avatar?: string | null;
  location?: string;
  website?: string;
  locale?: string | null;
  timezone?: string | null;
}

export interface UserRepository {
  create(input: NewUser): Promise<User>;
  get(id: Id): Promise<User | undefined>;
  getMany(ids: Id[]): Promise<Map<Id, User>>;
  byUsername(username: string): Promise<User | undefined>;
  byEmail(email: string): Promise<User | undefined>;
  update(id: Id, patch: Partial<Omit<User, "id" | "usernameKey" | "createdAt">>): Promise<User>;
  count(): Promise<number>;
  newest(): Promise<User | undefined>;
}

export type PasswordScheme = "argon2id" | "phpbb2-md5";
export interface Credential {
  userId: Id;
  scheme: PasswordScheme;
  hash: string;
  updatedAt: Millis;
}
export interface CredentialRepository {
  get(userId: Id): Promise<Credential | undefined>;
  set(userId: Id, scheme: PasswordScheme, hash: string): Promise<void>;
}

export interface GroupRepository {
  create(
    input: WithOptionalId<Omit<Group, "nameKey" | "createdAt">> & { createdAt?: Millis },
  ): Promise<Group>;
  get(id: Id): Promise<Group | undefined>;
  byName(name: string): Promise<Group | undefined>;
  addMember(m: Membership): Promise<void>;
  removeMember(groupId: Id, userId: Id): Promise<void>;
  members(groupId: Id): Promise<Membership[]>;
  /** Approved memberships only. */
  groupsOf(userId: Id): Promise<Id[]>;
}

export interface RoleRepository {
  /** Create or replace a role by key (capabilities replaced wholesale). */
  upsert(role: {
    key: string;
    name: string;
    builtin: boolean;
    capabilities: Record<string, Effect>;
  }): Promise<Role>;
  byKey(key: string): Promise<Role | undefined>;
  get(id: Id): Promise<Role | undefined>;
  all(): Promise<Role[]>;
}

export interface GrantRepository {
  create(roleId: Id, subject: Subject, nodeId: Id | null): Promise<Grant>;
  remove(id: Id): Promise<void>;
  /** Grants scoped to any of these nodes (pass null for board-wide grants). */
  forScopes(nodeIds: (Id | null)[]): Promise<Grant[]>;
  all(): Promise<Grant[]>;
}

export interface LegacyIdRepository {
  set(source: string, kind: string, legacyId: string, newId: Id): Promise<void>;
  get(source: string, kind: string, legacyId: string): Promise<Id | undefined>;
}

export interface SlugHistoryRepository {
  record(kind: "node" | "topic" | "user", slug: string, entityId: Id): Promise<void>;
  resolve(kind: "node" | "topic" | "user", slug: string): Promise<Id | undefined>;
}

export interface AuditLog {
  append(entry: Omit<AuditEntry, "id" | "at"> & { at?: Millis }): Promise<void>;
  recent(limit: number): Promise<AuditEntry[]>;
}

export interface RankRepository {
  create(rank: WithOptionalId<Rank>): Promise<Rank>;
  all(): Promise<Rank[]>;
}

export interface SmileyRepository {
  create(smiley: WithOptionalId<Smiley>): Promise<Smiley>;
  all(): Promise<Smiley[]>;
}

export interface Repositories {
  nodes: NodeRepository;
  topics: TopicRepository;
  posts: PostRepository;
  users: UserRepository;
  credentials: CredentialRepository;
  groups: GroupRepository;
  roles: RoleRepository;
  grants: GrantRepository;
  legacyIds: LegacyIdRepository;
  slugs: SlugHistoryRepository;
  audit: AuditLog;
  ranks: RankRepository;
  smilies: SmileyRepository;
  /** Runs fn atomically; the repositories passed in are bound to the transaction. */
  transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
}
