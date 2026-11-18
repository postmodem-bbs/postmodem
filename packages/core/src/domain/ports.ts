// SPDX-License-Identifier: AGPL-3.0-or-later
// Repository ports: what the core needs from storage. Implemented once in @postmodem/db
// for SQLite and Postgres (ADR 0013). E-mail tokens arrive with mail (slice 4b).
import type {
  AuditEntry,
  Ban,
  Effect,
  EmailTokenPurpose,
  Grant,
  Group,
  Id,
  Invite,
  Job,
  MarkupFormat,
  Membership,
  Millis,
  Node,
  NodeKind,
  Poll,
  Post,
  PrivateMessage,
  Rank,
  Role,
  Session,
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
  /** A new public post in the node (and a new topic, if `topic`): counts and last post, no recount. */
  notePost(id: Id, post: { id: Id; topic: boolean }): Promise<void>;
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
  getMany(ids: Id[]): Promise<Map<Id, Topic>>;
  bySlug(slug: string): Promise<Topic | undefined>;
  /** Changes the title and slug; the old slug keeps resolving through slug_history. */
  rename(id: Id, title: string): Promise<Topic>;
  setType(id: Id, type: TopicType): Promise<void>;
  setVisibility(id: Id, visibility: VisibilityState): Promise<void>;
  setLocked(id: Id, locked: boolean): Promise<void>;
  /** Turns the topic into a "moved" shadow of another (its old links then lead there). */
  markMoved(id: Id, targetId: Id): Promise<void>;
  /** Moves the topic and its posts to another node (counters: recount both nodes). */
  moveTo(id: Id, nodeId: Id): Promise<void>;
  /** A new public post in the topic: reply count, first/last post and activity, without a recount. */
  notePost(id: Id, post: { id: Id; createdAt: Millis; first: boolean }): Promise<void>;
  /** Announcements, then stickies, then the rest; each by most recent activity. */
  listByNode(nodeId: Id, page: PageRequest, opts?: { visibility?: VisibilityState[] }): Promise<Page<Topic>>;
  /** Public topics a user started in the given nodes, newest first (profiles). */
  recentByAuthor(authorId: Id, nodeIds: Id[], limit: number): Promise<Topic[]>;
  /** Recomputes reply count, first/last post and last activity from posts. */
  recount(id: Id): Promise<Topic>;
  /**
   * Bulk insert with explicit ids (importers). Slugs are `<title-slug>-<id>`; counters stay
   * zero until `recount`.
   */
  insertMany(rows: (NewTopic & { id: Id })[]): Promise<void>;
  addViews(id: Id, n: number): Promise<void>;
}

export interface NewPost {
  id?: Id;
  topicId: Id;
  authorId: Id | null;
  authorName?: string;
  subject?: string;
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
  getMany(ids: Id[]): Promise<Map<Id, Post>>;
  /** Oldest first, as a classic board reads. */
  listByTopic(topicId: Id, page: PageRequest, opts?: { visibility?: VisibilityState[] }): Promise<Page<Post>>;
  /** 0-based position of a post within its topic (for `?p=` permalinks to the right page). */
  positionInTopic(postId: Id): Promise<number | undefined>;
  setRendered(id: Id, html: string, renderVersion: number): Promise<void>;
  /** New text (and subject); the cached HTML is dropped so the next read renders it again. */
  edit(
    id: Id,
    patch: { source: string; subject?: string; editedAt: Millis | null; editCount: number },
  ): Promise<Post>;
  setVisibility(id: Id, visibility: VisibilityState): Promise<void>;
  /** Moves posts into another topic (split, merge); counters: recount both topics. */
  moveTo(postIds: Id[], topicId: Id): Promise<void>;
  /** Posts by id, after `afterId` (bulk jobs such as rebuilding the search index). */
  batchAfter(afterId: Id, limit: number): Promise<Post[]>;
  /** Every post of a topic, any visibility, oldest first (moderation). */
  allInTopic(topicId: Id): Promise<Post[]>;
  /** When the user last posted (flood interval). */
  lastByAuthor(authorId: Id): Promise<Millis | undefined>;
  /** Bulk insert with explicit ids and node (importers); no per-row lookups. */
  insertMany(rows: (NewPost & { id: Id; nodeId: Id })[]): Promise<void>;
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
  rulesVersion?: number | null;
  rulesAcceptedAt?: Millis | null;
  notifyPm?: boolean;
  autoWatch?: boolean;
}

export interface UserRepository {
  create(input: NewUser): Promise<User>;
  get(id: Id): Promise<User | undefined>;
  getMany(ids: Id[]): Promise<Map<Id, User>>;
  byUsername(username: string): Promise<User | undefined>;
  bySlug(slug: string): Promise<User | undefined>;
  /** A local user whose name looks the same (same `skeleton()`), if any. */
  lookalike(username: string): Promise<User | undefined>;
  byEmail(email: string): Promise<User | undefined>;
  update(id: Id, patch: Partial<Omit<User, "id" | "usernameKey" | "createdAt">>): Promise<User>;
  adjustPostCount(id: Id, by: number): Promise<void>;
  /** Active local members for the member list. */
  list(q: {
    sort: "joined" | "username" | "posts";
    order: "asc" | "desc";
    page: PageRequest;
  }): Promise<Page<User>>;
  count(): Promise<number>;
  newest(): Promise<User | undefined>;
}

export type PasswordScheme = "argon2id" | "phpbb2-md5" | "phpass";
export interface Credential {
  userId: Id;
  scheme: PasswordScheme;
  hash: string;
  updatedAt: Millis;
}
export interface CredentialRepository {
  get(userId: Id): Promise<Credential | undefined>;
  set(userId: Id, scheme: PasswordScheme, hash: string): Promise<void>;
  /** Deletes the password; the user can only get in again through a password reset. */
  remove(userId: Id): Promise<void>;
  /**
   * Users still on a legacy hash (phpBB2 MD5, phpass) who haven't signed in since `before`
   * (imported accounts that never signed in count as never seen).
   */
  legacyUnusedSince(before: Millis): Promise<{ userId: Id; scheme: PasswordScheme }[]>;
}

export interface SessionRepository {
  create(session: Session): Promise<void>;
  get(id: string): Promise<Session | undefined>;
  /** Slides the idle window: records activity and the new expiry. */
  touch(id: string, lastSeenAt: Millis, expiresAt: Millis): Promise<void>;
  remove(id: string): Promise<void>;
  /** Signs a user out everywhere (optionally keeping one session). Returns how many ended. */
  removeForUser(userId: Id, keep?: string): Promise<number>;
  listForUser(userId: Id): Promise<Session[]>;
  /** Users with an unexpired session used since `since` (who's online), most recent first. */
  activeUserIds(since: Millis, now: Millis): Promise<Id[]>;
  purgeExpired(now: Millis): Promise<number>;
}

export interface JobRepository {
  enqueue(type: string, payload: unknown, opts?: { runAt?: Millis; maxAttempts?: number }): Promise<Id>;
  /**
   * Atomically takes the oldest due job of these types (or one whose lease ran out) for
   * `workerId` until `now + leaseMs`. Safe with many workers on SQLite and Postgres.
   */
  claim(types: string[], workerId: string, now: Millis, leaseMs: number): Promise<Job | undefined>;
  /** Marks a job done and drops its payload (payloads may hold one-time links). */
  complete(id: Id, now: Millis): Promise<void>;
  /** Records a failed attempt: retried at `retryAt`, or failed for good (payload dropped) when null. */
  fail(id: Id, error: string, now: Millis, retryAt: Millis | null): Promise<void>;
  get(id: Id): Promise<Job | undefined>;
  /** Removes done/failed jobs finished before this time. */
  purgeFinished(before: Millis): Promise<number>;
}

export interface EmailTokenRepository {
  create(t: {
    userId: Id;
    purpose: EmailTokenPurpose;
    tokenHash: string;
    expiresAt: Millis;
    createdAt: Millis;
  }): Promise<void>;
  /** The user a live (unused, unexpired) token belongs to, without using it. */
  peek(tokenHash: string, purpose: EmailTokenPurpose, now: Millis): Promise<Id | undefined>;
  /** Uses a live token exactly once; concurrent attempts get undefined. */
  consume(tokenHash: string, purpose: EmailTokenPurpose, now: Millis): Promise<Id | undefined>;
  /** Invalidates every live token of this purpose for the user (e.g. after a reset). */
  revoke(userId: Id, purpose: EmailTokenPurpose, now: Millis): Promise<void>;
  /** When the user's newest token of this purpose was issued, for resend limits. */
  lastIssued(userId: Id, purpose: EmailTokenPurpose): Promise<Millis | undefined>;
}

/** Shared store for core/auth Throttle, so every replica sees the same counts. */
export interface ThrottleRepository {
  get(key: string): Promise<{ failures: number; last: Millis } | undefined>;
  put(key: string, failures: number, last: Millis): Promise<void>;
  remove(key: string): Promise<void>;
  purge(before: Millis): Promise<number>;
}

export interface GroupRepository {
  create(
    input: WithOptionalId<Omit<Group, "nameKey" | "createdAt">> & { createdAt?: Millis },
  ): Promise<Group>;
  get(id: Id): Promise<Group | undefined>;
  byName(name: string): Promise<Group | undefined>;
  /** Every group, by name. */
  all(): Promise<Group[]>;
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
  /** Every mapping of one kind, from any source (small kinds only, e.g. categories). */
  list(kind: string): Promise<{ source: string; legacyId: string; newId: Id }[]>;
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

export interface PollRepository {
  /** One poll per topic; `id` may keep the legacy vote_id. */
  create(poll: Omit<Poll, "id" | "voterCount"> & { id?: Id }): Promise<Poll>;
  forTopic(topicId: Id): Promise<Poll | undefined>;
  /** Who voted (so nobody votes twice once voting exists); ignores repeats. */
  addVoters(pollId: Id, userIds: Id[]): Promise<void>;
}

export interface BanRepository {
  create(ban: Omit<Ban, "id" | "createdAt"> & { createdAt?: Millis }): Promise<Ban>;
  remove(id: Id): Promise<void>;
  /** Unexpired bans, newest first. */
  active(now: Millis): Promise<Ban[]>;
}

export interface PrivateMessageRepository {
  create(
    m: Omit<PrivateMessage, "id" | "readAt" | "senderDeleted" | "recipientDeleted"> & {
      id?: Id;
      readAt?: Millis | null;
      senderDeleted?: boolean;
      recipientDeleted?: boolean;
    },
  ): Promise<PrivateMessage>;
  get(id: Id): Promise<PrivateMessage | undefined>;
  /** The folder's messages, newest first, that the user hasn't deleted. */
  inbox(userId: Id, page: PageRequest): Promise<Page<PrivateMessage>>;
  sent(userId: Id, page: PageRequest): Promise<Page<PrivateMessage>>;
  unreadCount(userId: Id): Promise<number>;
  inboxCount(userId: Id): Promise<number>;
  markRead(id: Id, at: Millis): Promise<void>;
  /** Deletes one side's view; the row goes when both sides have deleted it. */
  deleteFor(id: Id, userId: Id): Promise<void>;
}

/** phpBB2's topics_watch: who gets an e-mail on a reply, once until they visit again. */
export interface WatchRepository {
  watch(userId: Id, topicId: Id): Promise<void>;
  unwatch(userId: Id, topicId: Id): Promise<void>;
  isWatching(userId: Id, topicId: Id): Promise<boolean>;
  /** Watchers not yet notified since their last visit; marks them notified. */
  takeWatchersToNotify(topicId: Id, except: Id): Promise<Id[]>;
  /** The member read the topic: the next reply notifies them again. */
  visited(userId: Id, topicId: Id): Promise<void>;
}

/** One post as the search index sees it (text already folded, see foldForSearch). */
export interface SearchDocument {
  postId: Id;
  topicId: Id;
  nodeId: Id;
  authorId: Id | null;
  createdAt: Millis;
  title: string;
  body: string;
}

/** Search provider (registry #7): the database's full-text index until another is installed. */
export interface SearchRepository {
  /** Adds or replaces documents. */
  index(docs: SearchDocument[]): Promise<void>;
  remove(postIds: Id[]): Promise<void>;
  clear(): Promise<void>;
  /**
   * Public posts matching every term (prefixes too), in the given nodes, newest first.
   * Terms are folded words of [a-z0-9] only (see searchTerms).
   */
  query(q: { terms: string[]; nodeIds: Id[]; authorId?: Id | null; page: PageRequest }): Promise<Page<Id>>;
}

export interface InviteRepository {
  create(i: Omit<Invite, "id" | "createdAt"> & { createdAt?: Millis }): Promise<Invite>;
  /** A usable invite (uses left, not expired) by its code's hash. */
  usable(codeHash: string, now: Millis): Promise<Invite | undefined>;
  /** Takes one use; false if none was left (someone else got there first). */
  consume(id: Id): Promise<boolean>;
  list(): Promise<Invite[]>;
  remove(id: Id): Promise<void>;
}

export interface Repositories {
  nodes: NodeRepository;
  topics: TopicRepository;
  posts: PostRepository;
  users: UserRepository;
  credentials: CredentialRepository;
  sessions: SessionRepository;
  emailTokens: EmailTokenRepository;
  jobs: JobRepository;
  throttle: ThrottleRepository;
  groups: GroupRepository;
  roles: RoleRepository;
  grants: GrantRepository;
  legacyIds: LegacyIdRepository;
  slugs: SlugHistoryRepository;
  audit: AuditLog;
  ranks: RankRepository;
  smilies: SmileyRepository;
  polls: PollRepository;
  bans: BanRepository;
  messages: PrivateMessageRepository;
  watches: WatchRepository;
  search: SearchRepository;
  invites: InviteRepository;
  /** Runs fn atomically; the repositories passed in are bound to the transaction. */
  transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
}
