// SPDX-License-Identifier: AGPL-3.0-or-later
// One implementation of the core repository ports for SQLite and Postgres (ADR 0013).
// Counters (topic/post counts, last posts) are not maintained on every insert here: the
// importer writes in bulk and then calls recount(); posting (M2) will update them incrementally.
import {
  type AuditEntry,
  type Ban,
  childPath,
  depthOf,
  type Effect,
  type Grant,
  type Group,
  type GroupKind,
  type Id,
  type Invite,
  idsOf,
  type Job,
  type JobStatus,
  type Membership,
  type Node,
  type NodeKind,
  nameKey,
  type Page,
  type PageRequest,
  type PasswordScheme,
  type Post,
  type PrivateMessage,
  planMove,
  type Rank,
  type Repositories,
  type Role,
  rootPath,
  type Session,
  type Smiley,
  type Subject,
  skeleton,
  slugify,
  type Topic,
  USER_SLUG_MAX,
  type User,
  type UserStatus,
} from "@postmodem/core";
import { type ExpressionBuilder, type Kysely, type Selectable, sql } from "kysely";

/** Search results are counted (and paged) up to this many, as phpBB2 did. */
export const SEARCH_RESULTS_MAX = 1000;

import type {
  JobsTable,
  NodesTable,
  PostsTable,
  Schema,
  SessionsTable,
  TopicsTable,
  UsersTable,
} from "./schema.ts";

type Db = Kysely<Schema>;
const PUBLIC = ["core:public"];

/** Run fn in a transaction unless we're already inside one (no nested transactions). */
const atomic = <T>(db: Db, fn: (db: Db) => Promise<T>): Promise<T> =>
  db.isTransaction ? fn(db) : db.transaction().execute((trx) => fn(trx));

const pending = () => `__pending_${Math.random().toString(36).slice(2)}`;

async function uniqueSlug(
  db: Db,
  table: "nodes" | "topics" | "users",
  base: string,
  id: Id,
  fallback: string,
) {
  const slug = base || fallback;
  const clash = await db
    .selectFrom(table)
    .select("id")
    .where("slug", "=", slug)
    .where("id", "!=", id)
    .executeTakeFirst();
  return clash ? `${slug}-${id}` : slug;
}

const SLUG_KIND = { nodes: "node", topics: "topic", users: "user" } as const;

/** Gives a renamed entity a new slug and keeps the old one resolving (ADR 0012). */
async function reslug(db: Db, table: "nodes" | "topics" | "users", id: Id, title: string, max = 80) {
  const row = await db.selectFrom(table).select("slug").where("id", "=", id).executeTakeFirst();
  if (!row) return;
  const fallback = `${SLUG_KIND[table]}-${id}`;
  const base = slugify(title, max);
  // Imported topics carry their id (`title-123`); keep that shape so renames don't collide.
  const keepsId = table === "topics" && row.slug.endsWith(`-${id}`);
  const wanted = keepsId ? `${base || "topic"}-${id}` : base;
  const slug = await uniqueSlug(db, table, wanted, id, fallback);
  if (slug === row.slug) return;
  await db
    .insertInto("slugHistory")
    .values({ kind: SLUG_KIND[table], slug: row.slug, entityId: id, createdAt: Date.now() })
    .onConflict((oc) => oc.columns(["kind", "slug"]).doUpdateSet({ entityId: id }))
    .execute();
  await db.updateTable(table).set({ slug }).where("id", "=", id).execute();
}

function paginate<T>(items: T[], total: number, p: PageRequest): Page<T> {
  return { items, total, page: p.page, perPage: p.perPage, pages: Math.max(1, Math.ceil(total / p.perPage)) };
}
const offset = (p: PageRequest) => (Math.max(1, p.page) - 1) * p.perPage;
const n = (v: unknown) => Number(v ?? 0);

const toNode = (r: Selectable<NodesTable>): Node => ({
  id: r.id,
  parentId: r.parentId,
  path: r.path,
  depth: r.depth,
  position: r.position,
  kind: r.kind as NodeKind,
  title: r.title,
  slug: r.slug,
  description: r.description,
  linkUrl: r.linkUrl,
  locked: r.locked === 1,
  topicCount: n(r.topicCount),
  postCount: n(r.postCount),
  lastPostId: r.lastPostId,
  visibility: r.visibility,
  createdAt: n(r.createdAt),
  updatedAt: n(r.updatedAt),
});

const toTopic = (r: Selectable<TopicsTable>): Topic => ({
  id: r.id,
  nodeId: r.nodeId,
  title: r.title,
  slug: r.slug,
  authorId: r.authorId,
  authorName: r.authorName,
  type: r.type,
  locked: r.locked === 1,
  movedToTopicId: r.movedToTopicId,
  replyCount: n(r.replyCount),
  viewCount: n(r.viewCount),
  firstPostId: r.firstPostId,
  lastPostId: r.lastPostId,
  lastPostAt: r.lastPostAt === null ? null : n(r.lastPostAt),
  visibility: r.visibility,
  createdAt: n(r.createdAt),
  updatedAt: n(r.updatedAt),
});

const toPost = (r: Selectable<PostsTable>): Post => ({
  id: r.id,
  topicId: r.topicId,
  nodeId: r.nodeId,
  authorId: r.authorId,
  authorName: r.authorName,
  subject: r.subject,
  source: r.source,
  format: r.format,
  rendered: r.rendered,
  renderVersion: r.renderVersion,
  visibility: r.visibility,
  createdAt: n(r.createdAt),
  editedAt: r.editedAt === null ? null : n(r.editedAt),
  editCount: r.editCount,
});

const toUser = (r: Selectable<UsersTable>): User => ({
  id: r.id,
  username: r.username,
  usernameKey: r.usernameKey,
  slug: r.slug,
  email: r.email,
  origin: r.origin,
  status: r.status as UserStatus,
  createdAt: n(r.createdAt),
  lastSeenAt: r.lastSeenAt === null ? null : n(r.lastSeenAt),
  postCount: n(r.postCount),
  rankId: r.rankId,
  signatureSource: r.signatureSource,
  signatureFormat: r.signatureFormat,
  avatar: r.avatar,
  location: r.location,
  website: r.website,
  locale: r.locale,
  timezone: r.timezone,
  rulesVersion: r.rulesVersion === null ? null : n(r.rulesVersion),
  rulesAcceptedAt: r.rulesAcceptedAt === null ? null : n(r.rulesAcceptedAt),
  notifyPm: !!r.notifyPm,
  autoWatch: !!r.autoWatch,
});

const toJob = (r: Selectable<JobsTable>): Job => ({
  id: n(r.id),
  type: r.type,
  payload: JSON.parse(r.payload),
  status: r.status as JobStatus,
  runAt: n(r.runAt),
  attempts: n(r.attempts),
  maxAttempts: n(r.maxAttempts),
  lockedBy: r.lockedBy,
  lockedUntil: r.lockedUntil === null ? null : n(r.lockedUntil),
  lastError: r.lastError,
  createdAt: n(r.createdAt),
  finishedAt: r.finishedAt === null ? null : n(r.finishedAt),
});

const toSession = (r: Selectable<SessionsTable>): Session => ({
  id: r.id,
  userId: n(r.userId),
  createdAt: n(r.createdAt),
  lastSeenAt: n(r.lastSeenAt),
  expiresAt: n(r.expiresAt),
  userAgent: r.userAgent,
  ip: r.ip,
});

const emailKey = (email: string | null | undefined) => (email ? email.trim().toLowerCase() : null);

const subjectToRow = (s: Subject) => ({ subjectType: s.type, subjectId: "id" in s ? s.id : null });
const rowToSubject = (type: string, id: number | null): Subject =>
  type === "group" || type === "user" ? ({ type, id: id! } as Subject) : ({ type } as Subject);

export function createRepositories(db: Db, dialect: "sqlite" | "pg"): Repositories {
  const nodes: Repositories["nodes"] = {
    async create(input) {
      return atomic(db, async (db) => {
        const self = createRepositories(db, dialect); // queries inside a transaction must use it
        const now = input.createdAt ?? Date.now();
        const parent = input.parentId === null ? undefined : await self.nodes.get(input.parentId);
        if (input.parentId !== null && !parent)
          throw new Error(`parent node ${input.parentId} does not exist`);
        const { id } = await db
          .insertInto("nodes")
          .values({
            ...(input.id !== undefined ? { id: input.id } : {}),
            parentId: input.parentId,
            path: "",
            depth: 0,
            position: input.position ?? 0,
            kind: input.kind,
            title: input.title,
            slug: pending(),
            description: input.description ?? "",
            linkUrl: input.linkUrl ?? null,
            locked: input.locked ? 1 : 0,
            topicCount: 0,
            postCount: 0,
            lastPostId: null,
            visibility: "core:public",
            createdAt: now,
            updatedAt: now,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const path = parent ? childPath(parent.path, id) : rootPath(id);
        const slug = await uniqueSlug(
          db,
          "nodes",
          input.slug ?? slugify(input.title),
          id,
          `${input.kind}-${id}`,
        );
        await db
          .updateTable("nodes")
          .set({ path, depth: depthOf(path), slug })
          .where("id", "=", id)
          .execute();
        return (await self.nodes.get(id))!;
      });
    },
    async get(id) {
      const r = await db.selectFrom("nodes").selectAll().where("id", "=", id).executeTakeFirst();
      return r && toNode(r);
    },
    async bySlug(slug) {
      const r = await db.selectFrom("nodes").selectAll().where("slug", "=", slug).executeTakeFirst();
      return r && toNode(r);
    },
    async children(parentId) {
      let q = db.selectFrom("nodes").selectAll();
      q = parentId === null ? q.where("parentId", "is", null) : q.where("parentId", "=", parentId);
      return (await q.orderBy("position").orderBy("id").execute()).map(toNode);
    },
    async tree() {
      const all = (await db.selectFrom("nodes").selectAll().orderBy("position").orderBy("id").execute()).map(
        toNode,
      );
      const byParent = new Map<Id | null, Node[]>();
      for (const node of all) {
        const list = byParent.get(node.parentId) ?? [];
        list.push(node);
        byParent.set(node.parentId, list);
      }
      const out: Node[] = [];
      const walk = (parent: Id | null) => {
        for (const child of byParent.get(parent) ?? []) {
          out.push(child);
          walk(child.id);
        }
      };
      walk(null);
      return out;
    },
    async subtree(id) {
      const node = await nodes.get(id);
      if (!node) return [];
      const rows = await db.selectFrom("nodes").selectAll().where("path", "like", `${node.path}%`).execute();
      return rows.map(toNode).sort((a, b) => a.depth - b.depth || a.position - b.position || a.id - b.id);
    },
    async move(id, newParentId, position) {
      return atomic(db, async (db) => {
        const self = createRepositories(db, dialect);
        const node = await self.nodes.get(id);
        if (!node) throw new Error(`node ${id} does not exist`);
        const parent = newParentId === null ? undefined : await self.nodes.get(newParentId);
        if (newParentId !== null && !parent) throw new Error(`parent node ${newParentId} does not exist`);
        const newPath = planMove(id, node.path, parent?.path ?? null);
        const depthDelta = depthOf(newPath) - node.depth;
        // Rewrite the prefix of every path in the subtree in one statement.
        await db
          .updateTable("nodes")
          .set({
            path: sql<string>`cast(${newPath} as text) || substr(path, ${node.path.length + 1})`,
            depth: sql<number>`depth + ${depthDelta}`,
          })
          .where("path", "like", `${node.path}%`)
          .execute();
        await db
          .updateTable("nodes")
          .set({ parentId: newParentId, position: position ?? node.position, updatedAt: Date.now() })
          .where("id", "=", id)
          .execute();
        return (await self.nodes.get(id))!;
      });
    },
    async update(id, patch) {
      return atomic(db, async (db) => {
        const self = createRepositories(db, dialect);
        const before = await self.nodes.get(id);
        if (!before) throw new Error(`node ${id} does not exist`);
        await db
          .updateTable("nodes")
          .set({
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.description !== undefined ? { description: patch.description } : {}),
            ...(patch.position !== undefined ? { position: patch.position } : {}),
            ...(patch.linkUrl !== undefined ? { linkUrl: patch.linkUrl } : {}),
            ...(patch.locked !== undefined ? { locked: patch.locked ? 1 : 0 } : {}),
            updatedAt: Date.now(),
          })
          .where("id", "=", id)
          .execute();
        if (patch.title !== undefined && patch.title !== before.title)
          await reslug(db, "nodes", id, patch.title);
        return (await self.nodes.get(id))!;
      });
    },
    async removeEmpty(id) {
      const child = await db.selectFrom("nodes").select("id").where("parentId", "=", id).executeTakeFirst();
      const topic = await db.selectFrom("topics").select("id").where("nodeId", "=", id).executeTakeFirst();
      if (child || topic) return false;
      await db.deleteFrom("grants").where("nodeId", "=", id).execute();
      const r = await db.deleteFrom("nodes").where("id", "=", id).executeTakeFirst();
      return Number(r.numDeletedRows) === 1;
    },
    async notePost(id, post) {
      await db
        .updateTable("nodes")
        .set({
          topicCount: post.topic ? sql<number>`topic_count + 1` : sql<number>`topic_count`,
          postCount: sql<number>`post_count + 1`,
          lastPostId: post.id,
        })
        .where("id", "=", id)
        .execute();
    },
    async recount(id) {
      const topicCount = await db
        .selectFrom("topics")
        .select((eb) => eb.fn.countAll().as("c"))
        .where("nodeId", "=", id)
        .where("visibility", "in", PUBLIC)
        .where("movedToTopicId", "is", null)
        .executeTakeFirstOrThrow();
      const visiblePosts = db
        .selectFrom("posts")
        .innerJoin("topics", "topics.id", "posts.topicId")
        .where("posts.nodeId", "=", id)
        .where("posts.visibility", "in", PUBLIC)
        .where("topics.visibility", "in", PUBLIC)
        .where("topics.nodeId", "=", id);
      const postCount = await visiblePosts.select((eb) => eb.fn.countAll().as("c")).executeTakeFirstOrThrow();
      const last = await visiblePosts
        .select("posts.id")
        .orderBy("posts.createdAt", "desc")
        .orderBy("posts.id", "desc")
        .limit(1)
        .executeTakeFirst();
      await db
        .updateTable("nodes")
        .set({ topicCount: n(topicCount.c), postCount: n(postCount.c), lastPostId: last?.id ?? null })
        .where("id", "=", id)
        .execute();
      return (await nodes.get(id))!;
    },
  };

  const topics: Repositories["topics"] = {
    async create(input) {
      return atomic(db, async (db) => {
        const now = input.createdAt ?? Date.now();
        const { id } = await db
          .insertInto("topics")
          .values({
            ...(input.id !== undefined ? { id: input.id } : {}),
            nodeId: input.nodeId,
            title: input.title,
            slug: pending(),
            authorId: input.authorId,
            authorName: input.authorName ?? "",
            type: input.type ?? "normal",
            locked: input.locked ? 1 : 0,
            movedToTopicId: input.movedToTopicId ?? null,
            replyCount: 0,
            viewCount: input.viewCount ?? 0,
            firstPostId: null,
            lastPostId: null,
            lastPostAt: null,
            visibility: input.visibility ?? "core:public",
            createdAt: now,
            updatedAt: now,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const slug = await uniqueSlug(db, "topics", input.slug ?? slugify(input.title), id, `topic-${id}`);
        await db.updateTable("topics").set({ slug }).where("id", "=", id).execute();
        return (await createRepositories(db, dialect).topics.get(id))!;
      });
    },
    async get(id) {
      const r = await db.selectFrom("topics").selectAll().where("id", "=", id).executeTakeFirst();
      return r && toTopic(r);
    },
    async insertMany(rows) {
      if (!rows.length) return;
      await db
        .insertInto("topics")
        .values(
          rows.map((t) => {
            const at = t.createdAt ?? Date.now();
            return {
              id: t.id,
              nodeId: t.nodeId,
              title: t.title,
              slug: `${slugify(t.title, 60) || "topic"}-${t.id}`,
              authorId: t.authorId,
              authorName: t.authorName ?? "",
              type: t.type ?? "normal",
              locked: t.locked ? 1 : 0,
              movedToTopicId: t.movedToTopicId ?? null,
              replyCount: 0,
              viewCount: t.viewCount ?? 0,
              firstPostId: null,
              lastPostId: null,
              lastPostAt: null,
              visibility: t.visibility ?? "core:public",
              createdAt: at,
              updatedAt: at,
            };
          }),
        )
        .execute();
    },
    async getMany(ids) {
      if (!ids.length) return new Map();
      const rows = await db
        .selectFrom("topics")
        .selectAll()
        .where("id", "in", [...new Set(ids)])
        .execute();
      return new Map(rows.map((r) => [r.id, toTopic(r)]));
    },
    async bySlug(slug) {
      const r = await db.selectFrom("topics").selectAll().where("slug", "=", slug).executeTakeFirst();
      return r && toTopic(r);
    },
    async rename(id, title) {
      return atomic(db, async (db) => {
        const self = createRepositories(db, dialect);
        const before = await self.topics.get(id);
        if (!before) throw new Error(`topic ${id} does not exist`);
        if (title === before.title) return before;
        await db.updateTable("topics").set({ title, updatedAt: Date.now() }).where("id", "=", id).execute();
        await reslug(db, "topics", id, title);
        return (await self.topics.get(id))!;
      });
    },
    async listByNode(nodeId, page, opts) {
      const base = db
        .selectFrom("topics")
        .where("nodeId", "=", nodeId)
        .where("visibility", "in", opts?.visibility ?? PUBLIC);
      const total = await base.select((eb) => eb.fn.countAll().as("c")).executeTakeFirstOrThrow();
      const rows = await base
        .selectAll()
        .orderBy(sql`case type when 'announcement' then 0 when 'sticky' then 1 else 2 end`)
        // COALESCE avoids dialect differences in NULL ordering.
        .orderBy(sql`coalesce(last_post_at, created_at)`, "desc")
        .orderBy("id", "desc")
        .limit(page.perPage)
        .offset(offset(page))
        .execute();
      return paginate(rows.map(toTopic), n(total.c), page);
    },
    async recentByAuthor(authorId, nodeIds, limit) {
      if (!nodeIds.length) return [];
      const rows = await db
        .selectFrom("topics")
        .selectAll()
        .where("authorId", "=", authorId)
        .where("visibility", "in", PUBLIC)
        .where("movedToTopicId", "is", null)
        .where("nodeId", "in", nodeIds)
        .orderBy("createdAt", "desc")
        .orderBy("id", "desc")
        .limit(limit)
        .execute();
      return rows.map(toTopic);
    },
    async recount(id) {
      const visible = db.selectFrom("posts").where("topicId", "=", id).where("visibility", "in", PUBLIC);
      const count = await visible.select((eb) => eb.fn.countAll().as("c")).executeTakeFirstOrThrow();
      const first = await visible.select("id").orderBy("createdAt").orderBy("id").limit(1).executeTakeFirst();
      const last = await visible
        .select(["id", "createdAt"])
        .orderBy("createdAt", "desc")
        .orderBy("id", "desc")
        .limit(1)
        .executeTakeFirst();
      await db
        .updateTable("topics")
        .set({
          replyCount: Math.max(0, n(count.c) - 1),
          firstPostId: first?.id ?? null,
          lastPostId: last?.id ?? null,
          lastPostAt: last ? n(last.createdAt) : null,
        })
        .where("id", "=", id)
        .execute();
      return (await topics.get(id))!;
    },
    async setLocked(id, locked) {
      await db
        .updateTable("topics")
        .set({ locked: locked ? 1 : 0, updatedAt: Date.now() })
        .where("id", "=", id)
        .execute();
    },
    async markMoved(id, targetId) {
      await db
        .updateTable("topics")
        .set({ movedToTopicId: targetId, updatedAt: Date.now() })
        .where("id", "=", id)
        .execute();
    },
    async moveTo(id, nodeId) {
      await db.updateTable("topics").set({ nodeId, updatedAt: Date.now() }).where("id", "=", id).execute();
      await db.updateTable("posts").set({ nodeId }).where("topicId", "=", id).execute();
    },
    async setType(id, type) {
      await db.updateTable("topics").set({ type, updatedAt: Date.now() }).where("id", "=", id).execute();
    },
    async setVisibility(id, visibility) {
      await db
        .updateTable("topics")
        .set({ visibility, updatedAt: Date.now() })
        .where("id", "=", id)
        .execute();
    },
    async notePost(id, post) {
      await db
        .updateTable("topics")
        .set({
          replyCount: post.first ? sql<number>`reply_count` : sql<number>`reply_count + 1`,
          firstPostId: sql<number>`coalesce(first_post_id, ${post.id})`,
          lastPostId: post.id,
          lastPostAt: post.createdAt,
          updatedAt: post.createdAt,
        })
        .where("id", "=", id)
        .execute();
    },
    async addViews(id, by) {
      await db
        .updateTable("topics")
        .set({ viewCount: sql<number>`view_count + ${by}` })
        .where("id", "=", id)
        .execute();
    },
  };

  const posts: Repositories["posts"] = {
    async create(input) {
      const topic = await topics.get(input.topicId);
      if (!topic) throw new Error(`topic ${input.topicId} does not exist`);
      const { id } = await db
        .insertInto("posts")
        .values({
          ...(input.id !== undefined ? { id: input.id } : {}),
          topicId: input.topicId,
          nodeId: topic.nodeId,
          authorId: input.authorId,
          authorName: input.authorName ?? "",
          subject: input.subject ?? "",
          source: input.source,
          format: input.format,
          rendered: null,
          renderVersion: 0,
          visibility: input.visibility ?? "core:public",
          createdAt: input.createdAt ?? Date.now(),
          editedAt: input.editedAt ?? null,
          editCount: input.editCount ?? 0,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return (await posts.get(id))!;
    },
    async get(id) {
      const r = await db.selectFrom("posts").selectAll().where("id", "=", id).executeTakeFirst();
      return r && toPost(r);
    },
    async insertMany(rows) {
      if (!rows.length) return;
      await db
        .insertInto("posts")
        .values(
          rows.map((p) => ({
            id: p.id,
            topicId: p.topicId,
            nodeId: p.nodeId,
            authorId: p.authorId,
            authorName: p.authorName ?? "",
            subject: p.subject ?? "",
            source: p.source,
            format: p.format,
            rendered: null,
            renderVersion: 0,
            visibility: p.visibility ?? "core:public",
            createdAt: p.createdAt ?? Date.now(),
            editedAt: p.editedAt ?? null,
            editCount: p.editCount ?? 0,
          })),
        )
        .execute();
    },
    async getMany(ids) {
      if (!ids.length) return new Map();
      const rows = await db
        .selectFrom("posts")
        .selectAll()
        .where("id", "in", [...new Set(ids)])
        .execute();
      return new Map(rows.map((r) => [r.id, toPost(r)]));
    },
    async listByTopic(topicId, page, opts) {
      const base = db
        .selectFrom("posts")
        .where("topicId", "=", topicId)
        .where("visibility", "in", opts?.visibility ?? PUBLIC);
      const total = await base.select((eb) => eb.fn.countAll().as("c")).executeTakeFirstOrThrow();
      const rows = await base
        .selectAll()
        .orderBy("createdAt")
        .orderBy("id")
        .limit(page.perPage)
        .offset(offset(page))
        .execute();
      return paginate(rows.map(toPost), n(total.c), page);
    },
    async positionInTopic(postId) {
      const post = await posts.get(postId);
      if (!post) return undefined;
      const before = await db
        .selectFrom("posts")
        .select((eb) => eb.fn.countAll().as("c"))
        .where("topicId", "=", post.topicId)
        .where("visibility", "in", PUBLIC)
        .where((eb) =>
          eb.or([
            eb("createdAt", "<", post.createdAt),
            eb.and([eb("createdAt", "=", post.createdAt), eb("id", "<", post.id)]),
          ]),
        )
        .executeTakeFirstOrThrow();
      return n(before.c);
    },
    async setRendered(id, html, renderVersion) {
      await db.updateTable("posts").set({ rendered: html, renderVersion }).where("id", "=", id).execute();
    },
    async edit(id, patch) {
      await db
        .updateTable("posts")
        .set({
          source: patch.source,
          ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
          editedAt: patch.editedAt,
          editCount: patch.editCount,
          rendered: null,
          renderVersion: 0,
        })
        .where("id", "=", id)
        .execute();
      return (await posts.get(id))!;
    },
    async setVisibility(id, visibility) {
      await db.updateTable("posts").set({ visibility }).where("id", "=", id).execute();
    },
    async moveTo(postIds, topicId) {
      if (!postIds.length) return;
      const topic = await db
        .selectFrom("topics")
        .select("nodeId")
        .where("id", "=", topicId)
        .executeTakeFirstOrThrow();
      await db
        .updateTable("posts")
        .set({ topicId, nodeId: topic.nodeId })
        .where("id", "in", postIds)
        .execute();
    },
    async byAuthor(authorId, afterId, limit) {
      const rows = await db
        .selectFrom("posts")
        .selectAll()
        .where("authorId", "=", authorId)
        .where("id", ">", afterId)
        .orderBy("id")
        .limit(limit)
        .execute();
      return rows.map(toPost);
    },
    async anonymiseAuthor(authorId, name) {
      await db
        .updateTable("posts")
        .set({ authorId: null, authorName: name })
        .where("authorId", "=", authorId)
        .execute();
      await db
        .updateTable("topics")
        .set({ authorId: null, authorName: name })
        .where("authorId", "=", authorId)
        .execute();
    },
    async batchAfter(afterId, limit) {
      const rows = await db
        .selectFrom("posts")
        .selectAll()
        .where("id", ">", afterId)
        .orderBy("id")
        .limit(limit)
        .execute();
      return rows.map(toPost);
    },
    async allInTopic(topicId) {
      const rows = await db
        .selectFrom("posts")
        .selectAll()
        .where("topicId", "=", topicId)
        .orderBy("createdAt")
        .orderBy("id")
        .execute();
      return rows.map(toPost);
    },
    async lastByAuthor(authorId) {
      const r = await db
        .selectFrom("posts")
        .select((eb) => eb.fn.max("createdAt").as("at"))
        .where("authorId", "=", authorId)
        .executeTakeFirst();
      return r?.at == null ? undefined : n(r.at);
    },
  };

  const users: Repositories["users"] = {
    async create(input) {
      const { id } = await db
        .insertInto("users")
        .values({
          ...(input.id !== undefined ? { id: input.id } : {}),
          username: input.username,
          usernameKey: nameKey(input.username),
          slug: pending(),
          usernameSkeleton: skeleton(input.username),
          email: input.email,
          emailKey: emailKey(input.email),
          origin: input.origin ?? "local",
          status: input.status ?? "active",
          createdAt: input.createdAt ?? Date.now(),
          lastSeenAt: input.lastSeenAt ?? null,
          postCount: input.postCount ?? 0,
          rankId: input.rankId ?? null,
          signatureSource: input.signatureSource ?? "",
          signatureFormat: input.signatureFormat ?? "bbcode-phpbb2",
          avatar: input.avatar ?? null,
          location: input.location ?? "",
          website: input.website ?? "",
          locale: input.locale ?? null,
          timezone: input.timezone ?? null,
          rulesVersion: input.rulesVersion ?? null,
          rulesAcceptedAt: input.rulesAcceptedAt ?? null,
          notifyPm: input.notifyPm === false ? 0 : 1,
          autoWatch: input.autoWatch === false ? 0 : 1,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const slug = await uniqueSlug(db, "users", slugify(input.username, USER_SLUG_MAX), id, `user-${id}`);
      await db.updateTable("users").set({ slug }).where("id", "=", id).execute();
      return (await users.get(id))!;
    },
    async get(id, options) {
      const query = db.selectFrom("users").selectAll().where("id", "=", id);
      const r = await (options?.forUpdate && dialect === "pg" ? query.forUpdate() : query).executeTakeFirst();
      return r && toUser(r);
    },
    async getMany(ids) {
      if (!ids.length) return new Map();
      const rows = await db
        .selectFrom("users")
        .selectAll()
        .where("id", "in", [...new Set(ids)])
        .execute();
      return new Map(rows.map((r) => [r.id, toUser(r)]));
    },
    async byUsername(username) {
      const r = await db
        .selectFrom("users")
        .selectAll()
        .where("origin", "=", "local")
        .where("usernameKey", "=", nameKey(username))
        .executeTakeFirst();
      return r && toUser(r);
    },
    async bySlug(slug) {
      const r = await db.selectFrom("users").selectAll().where("slug", "=", slug).executeTakeFirst();
      return r && toUser(r);
    },
    async lookalike(username) {
      const r = await db
        .selectFrom("users")
        .selectAll()
        .where("origin", "=", "local")
        .where("usernameSkeleton", "=", skeleton(username))
        .orderBy("id")
        .limit(1)
        .executeTakeFirst();
      return r && toUser(r);
    },
    async byEmail(email) {
      const r = await db
        .selectFrom("users")
        .selectAll()
        .where("emailKey", "=", emailKey(email))
        .executeTakeFirst();
      return r && toUser(r);
    },
    async update(id, patch) {
      const { email, slug: _slug, notifyPm, autoWatch, ...rest } = patch;
      const before = rest.username !== undefined ? await users.get(id) : undefined;
      await db
        .updateTable("users")
        .set({
          ...rest,
          ...(notifyPm !== undefined ? { notifyPm: notifyPm ? 1 : 0 } : {}),
          ...(autoWatch !== undefined ? { autoWatch: autoWatch ? 1 : 0 } : {}),
          ...(rest.username !== undefined
            ? { usernameKey: nameKey(rest.username), usernameSkeleton: skeleton(rest.username) }
            : {}),
          ...(email !== undefined ? { email, emailKey: emailKey(email) } : {}),
        })
        .where("id", "=", id)
        .execute();
      if (before && rest.username !== before.username)
        await reslug(db, "users", id, rest.username!, USER_SLUG_MAX);
      const user = await users.get(id);
      if (!user) throw new Error(`user ${id} does not exist`);
      return user;
    },
    async list(q) {
      const base = db.selectFrom("users").where("origin", "=", "local").where("status", "=", "active");
      const total = await base.select((eb) => eb.fn.countAll().as("c")).executeTakeFirstOrThrow();
      const column = q.sort === "username" ? "usernameKey" : q.sort === "posts" ? "postCount" : "createdAt";
      const rows = await base
        .selectAll()
        .orderBy(column, q.order)
        .orderBy("id", q.order)
        .limit(q.page.perPage)
        .offset(offset(q.page))
        .execute();
      return paginate(rows.map(toUser), n(total.c), q.page);
    },
    async adjustPostCount(id, by) {
      await db
        .updateTable("users")
        .set({ postCount: sql<number>`case when post_count + ${by} < 0 then 0 else post_count + ${by} end` })
        .where("id", "=", id)
        .execute();
    },
    async count() {
      const r = await db
        .selectFrom("users")
        .select((eb) => eb.fn.countAll().as("c"))
        .executeTakeFirstOrThrow();
      return n(r.c);
    },
    async newest() {
      const r = await db
        .selectFrom("users")
        .selectAll()
        .where("status", "=", "active")
        .where("origin", "=", "local")
        .orderBy("createdAt", "desc")
        .orderBy("id", "desc")
        .limit(1)
        .executeTakeFirst();
      return r && toUser(r);
    },
  };

  const credentials: Repositories["credentials"] = {
    async get(userId) {
      const r = await db
        .selectFrom("credentials")
        .selectAll()
        .where("userId", "=", userId)
        .executeTakeFirst();
      return (
        r && {
          userId: r.userId,
          scheme: r.scheme as PasswordScheme,
          hash: r.hash,
          updatedAt: n(r.updatedAt),
        }
      );
    },
    async set(userId, scheme, hash) {
      const updatedAt = Date.now();
      await db
        .insertInto("credentials")
        .values({ userId, scheme, hash, updatedAt })
        .onConflict((oc) => oc.column("userId").doUpdateSet({ scheme, hash, updatedAt }))
        .execute();
    },
    async remove(userId) {
      await db.deleteFrom("credentials").where("userId", "=", userId).execute();
    },
    async legacyUnusedSince(before) {
      const rows = await db
        .selectFrom("credentials")
        .innerJoin("users", "users.id", "credentials.userId")
        .select(["credentials.userId", "credentials.scheme"])
        .where("credentials.scheme", "!=", "argon2id")
        .where((eb) => eb.or([eb("users.lastSeenAt", "is", null), eb("users.lastSeenAt", "<", before)]))
        .orderBy("credentials.userId")
        .execute();
      return rows.map((r) => ({ userId: r.userId, scheme: r.scheme as PasswordScheme }));
    },
  };

  const toGroup = (r: Selectable<Schema["groups"]>): Group => ({
    id: r.id,
    name: r.name,
    nameKey: r.nameKey,
    description: r.description,
    kind: r.kind as GroupKind,
    createdAt: n(r.createdAt),
  });

  const groups: Repositories["groups"] = {
    async create(input) {
      const { id } = await db
        .insertInto("groups")
        .values({
          ...(input.id !== undefined ? { id: input.id } : {}),
          name: input.name,
          nameKey: nameKey(input.name),
          description: input.description,
          kind: input.kind,
          createdAt: input.createdAt ?? Date.now(),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return (await groups.get(id))!;
    },
    async get(id) {
      const r = await db.selectFrom("groups").selectAll().where("id", "=", id).executeTakeFirst();
      return r && toGroup(r);
    },
    async all() {
      const rows = await db.selectFrom("groups").selectAll().orderBy("nameKey").execute();
      return rows.map(toGroup);
    },
    async byName(name) {
      const r = await db
        .selectFrom("groups")
        .selectAll()
        .where("nameKey", "=", nameKey(name))
        .executeTakeFirst();
      return r && toGroup(r);
    },
    async addMember(m) {
      const values = { role: m.role, pending: m.pending ? 1 : 0 };
      await db
        .insertInto("memberships")
        .values({ groupId: m.groupId, userId: m.userId, ...values })
        .onConflict((oc) => oc.columns(["groupId", "userId"]).doUpdateSet(values))
        .execute();
    },
    async removeMember(groupId, userId) {
      await db
        .deleteFrom("memberships")
        .where("groupId", "=", groupId)
        .where("userId", "=", userId)
        .execute();
    },
    async members(groupId) {
      const rows = await db
        .selectFrom("memberships")
        .selectAll()
        .where("groupId", "=", groupId)
        .orderBy("userId")
        .execute();
      return rows.map(
        (r): Membership => ({
          groupId: r.groupId,
          userId: r.userId,
          role: r.role as Membership["role"],
          pending: r.pending === 1,
        }),
      );
    },
    async removeAllFor(userId) {
      await db.deleteFrom("memberships").where("userId", "=", userId).execute();
    },
    async groupsOf(userId) {
      const rows = await db
        .selectFrom("memberships")
        .select("groupId")
        .where("userId", "=", userId)
        .where("pending", "=", 0)
        .orderBy("groupId")
        .execute();
      return rows.map((r) => r.groupId);
    },
  };

  const roles: Repositories["roles"] = {
    async upsert(role) {
      return atomic(db, async (db) => {
        const existing = await db
          .selectFrom("roles")
          .select("id")
          .where("key", "=", role.key)
          .executeTakeFirst();
        const id = existing
          ? existing.id
          : (
              await db
                .insertInto("roles")
                .values({ key: role.key, name: role.name, builtin: role.builtin ? 1 : 0 })
                .returning("id")
                .executeTakeFirstOrThrow()
            ).id;
        if (existing)
          await db
            .updateTable("roles")
            .set({ name: role.name, builtin: role.builtin ? 1 : 0 })
            .where("id", "=", id)
            .execute();
        await db.deleteFrom("roleCapabilities").where("roleId", "=", id).execute();
        const caps = Object.entries(role.capabilities);
        if (caps.length) {
          await db
            .insertInto("roleCapabilities")
            .values(caps.map(([capability, effect]) => ({ roleId: id, capability, effect })))
            .execute();
        }
        return (await createRepositories(db, dialect).roles.get(id))!;
      });
    },
    async get(id) {
      const r = await db.selectFrom("roles").selectAll().where("id", "=", id).executeTakeFirst();
      if (!r) return undefined;
      const caps = await db.selectFrom("roleCapabilities").selectAll().where("roleId", "=", id).execute();
      return {
        id: r.id,
        key: r.key,
        name: r.name,
        builtin: r.builtin === 1,
        capabilities: Object.fromEntries(caps.map((c) => [c.capability, c.effect as Effect])),
      } satisfies Role;
    },
    async byKey(key) {
      const r = await db.selectFrom("roles").select("id").where("key", "=", key).executeTakeFirst();
      return r && roles.get(r.id);
    },
    async all() {
      const rows = await db.selectFrom("roles").select("id").orderBy("id").execute();
      return Promise.all(rows.map((r) => roles.get(r.id) as Promise<Role>));
    },
  };

  const toGrant = (r: Selectable<Schema["grants"]>): Grant => ({
    id: r.id,
    roleId: r.roleId,
    subject: rowToSubject(r.subjectType, r.subjectId),
    nodeId: r.nodeId,
    createdAt: n(r.createdAt),
  });

  const grants: Repositories["grants"] = {
    async create(roleId, subject, nodeId) {
      const { id } = await db
        .insertInto("grants")
        .values({ roleId, ...subjectToRow(subject), nodeId, createdAt: Date.now() })
        .returning("id")
        .executeTakeFirstOrThrow();
      return toGrant(
        await db.selectFrom("grants").selectAll().where("id", "=", id).executeTakeFirstOrThrow(),
      );
    },
    async remove(id) {
      await db.deleteFrom("grants").where("id", "=", id).execute();
    },
    async forScopes(nodeIds) {
      const ids = nodeIds.filter((x): x is Id => x !== null);
      const board = nodeIds.includes(null);
      if (!ids.length && !board) return [];
      const rows = await db
        .selectFrom("grants")
        .selectAll()
        .where((eb) => {
          const ors = [];
          if (ids.length) ors.push(eb("nodeId", "in", ids));
          if (board) ors.push(eb("nodeId", "is", null));
          return eb.or(ors);
        })
        .orderBy("id")
        .execute();
      return rows.map(toGrant);
    },
    async all() {
      return (await db.selectFrom("grants").selectAll().orderBy("id").execute()).map(toGrant);
    },
  };

  const legacyIds: Repositories["legacyIds"] = {
    async set(source, kind, legacyId, newId) {
      await db
        .insertInto("legacyIds")
        .values({ source, kind, legacyId, newId })
        .onConflict((oc) => oc.columns(["source", "kind", "legacyId"]).doUpdateSet({ newId }))
        .execute();
    },
    async get(source, kind, legacyId) {
      const r = await db
        .selectFrom("legacyIds")
        .select("newId")
        .where("source", "=", source)
        .where("kind", "=", kind)
        .where("legacyId", "=", legacyId)
        .executeTakeFirst();
      return r?.newId;
    },
    async list(kind) {
      return db
        .selectFrom("legacyIds")
        .select(["source", "legacyId", "newId"])
        .where("kind", "=", kind)
        .execute();
    },
  };

  const slugs: Repositories["slugs"] = {
    async record(kind, slug, entityId) {
      await db
        .insertInto("slugHistory")
        .values({ kind, slug, entityId, createdAt: Date.now() })
        .onConflict((oc) => oc.columns(["kind", "slug"]).doUpdateSet({ entityId }))
        .execute();
    },
    async resolve(kind, slug) {
      const r = await db
        .selectFrom("slugHistory")
        .select("entityId")
        .where("kind", "=", kind)
        .where("slug", "=", slug)
        .executeTakeFirst();
      return r?.entityId;
    },
  };

  const audit: Repositories["audit"] = {
    async append(e) {
      await db
        .insertInto("auditLog")
        .values({
          at: e.at ?? Date.now(),
          actorId: e.actorId,
          action: e.action,
          targetType: e.targetType,
          targetId: e.targetId,
          details: JSON.stringify(e.details),
        })
        .execute();
    },
    async recent(limit) {
      const rows = await db
        .selectFrom("auditLog")
        .selectAll()
        .orderBy("at", "desc")
        .orderBy("id", "desc")
        .limit(limit)
        .execute();
      return rows.map(
        (r): AuditEntry => ({
          id: r.id,
          at: n(r.at),
          actorId: r.actorId,
          action: r.action,
          targetType: r.targetType,
          targetId: r.targetId,
          details: JSON.parse(r.details) as Record<string, unknown>,
        }),
      );
    },
  };

  const ranks: Repositories["ranks"] = {
    async create(rank) {
      const { id } = await db
        .insertInto("ranks")
        .values({
          ...(rank.id !== undefined ? { id: rank.id } : {}),
          title: rank.title,
          minPosts: rank.minPosts,
          special: rank.special ? 1 : 0,
          image: rank.image,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { ...rank, id };
    },
    async all() {
      const rows = await db
        .selectFrom("ranks")
        .selectAll()
        .orderBy("special", "desc")
        .orderBy("minPosts")
        .orderBy("id")
        .execute();
      return rows.map(
        (r): Rank => ({
          id: r.id,
          title: r.title,
          minPosts: r.minPosts === null ? null : n(r.minPosts),
          special: r.special === 1,
          image: r.image,
        }),
      );
    },
  };

  const bans: Repositories["bans"] = {
    async create(b) {
      const { id } = await db
        .insertInto("bans")
        .values({
          kind: b.kind,
          value: b.value,
          reason: b.reason,
          createdBy: b.createdBy,
          createdAt: b.createdAt ?? Date.now(),
          expiresAt: b.expiresAt,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { ...b, id, createdAt: b.createdAt ?? Date.now() };
    },
    async remove(id) {
      await db.deleteFrom("bans").where("id", "=", id).execute();
    },
    async active(now) {
      const rows = await db
        .selectFrom("bans")
        .selectAll()
        .where((eb) => eb.or([eb("expiresAt", "is", null), eb("expiresAt", ">", now)]))
        .orderBy("createdAt", "desc")
        .orderBy("id", "desc")
        .execute();
      return rows.map((b) => ({
        id: b.id,
        kind: b.kind as Ban["kind"],
        value: b.value,
        reason: b.reason,
        createdBy: b.createdBy,
        createdAt: n(b.createdAt),
        expiresAt: b.expiresAt === null ? null : n(b.expiresAt),
      }));
    },
  };

  const toMessage = (m: Selectable<Schema["privateMessages"]>): PrivateMessage => ({
    id: m.id,
    senderId: m.senderId,
    recipientId: m.recipientId,
    subject: m.subject,
    source: m.source,
    createdAt: n(m.createdAt),
    readAt: m.readAt === null ? null : n(m.readAt),
    senderDeleted: !!m.senderDeleted,
    recipientDeleted: !!m.recipientDeleted,
  });
  const messageFolder = async (column: "recipientId" | "senderId", userId: Id, page: PageRequest) => {
    const deleted = column === "recipientId" ? "recipientDeleted" : "senderDeleted";
    const base = db.selectFrom("privateMessages").where(column, "=", userId).where(deleted, "=", 0);
    const total = await base.select((eb) => eb.fn.countAll().as("c")).executeTakeFirstOrThrow();
    const rows = await base
      .selectAll()
      .orderBy("createdAt", "desc")
      .orderBy("id", "desc")
      .limit(page.perPage)
      .offset(offset(page))
      .execute();
    return paginate(rows.map(toMessage), n(total.c), page);
  };
  const messages: Repositories["messages"] = {
    async create(m) {
      const { id } = await db
        .insertInto("privateMessages")
        .values({
          ...(m.id !== undefined ? { id: m.id } : {}),
          senderId: m.senderId,
          recipientId: m.recipientId,
          subject: m.subject,
          source: m.source,
          createdAt: m.createdAt,
          readAt: m.readAt ?? null,
          senderDeleted: m.senderDeleted ? 1 : 0,
          recipientDeleted: m.recipientDeleted ? 1 : 0,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return (await messages.get(id))!;
    },
    async get(id) {
      const r = await db.selectFrom("privateMessages").selectAll().where("id", "=", id).executeTakeFirst();
      return r && toMessage(r);
    },
    inbox: (userId, page) => messageFolder("recipientId", userId, page),
    sent: (userId, page) => messageFolder("senderId", userId, page),
    async unreadCount(userId) {
      const r = await db
        .selectFrom("privateMessages")
        .select((eb) => eb.fn.countAll().as("c"))
        .where("recipientId", "=", userId)
        .where("recipientDeleted", "=", 0)
        .where("readAt", "is", null)
        .executeTakeFirstOrThrow();
      return n(r.c);
    },
    async inboxCount(userId) {
      const r = await db
        .selectFrom("privateMessages")
        .select((eb) => eb.fn.countAll().as("c"))
        .where("recipientId", "=", userId)
        .where("recipientDeleted", "=", 0)
        .executeTakeFirstOrThrow();
      return n(r.c);
    },
    async markRead(id, at) {
      await db
        .updateTable("privateMessages")
        .set({ readAt: at })
        .where("id", "=", id)
        .where("readAt", "is", null)
        .execute();
    },
    async allFor(userId) {
      const rows = await db
        .selectFrom("privateMessages")
        .selectAll()
        .where((eb) =>
          eb.or([
            eb.and([eb("recipientId", "=", userId), eb("recipientDeleted", "=", 0)]),
            eb.and([eb("senderId", "=", userId), eb("senderDeleted", "=", 0)]),
          ]),
        )
        .orderBy("createdAt")
        .execute();
      return rows.map(toMessage);
    },
    async deleteFor(id, userId) {
      const m = await messages.get(id);
      if (!m) return;
      const patch = {
        ...(m.recipientId === userId ? { recipientDeleted: 1 } : {}),
        ...(m.senderId === userId ? { senderDeleted: 1 } : {}),
      };
      if (!Object.keys(patch).length) return;
      await db.updateTable("privateMessages").set(patch).where("id", "=", id).execute();
      await db
        .deleteFrom("privateMessages")
        .where("id", "=", id)
        .where("recipientDeleted", "=", 1)
        .where((eb) => eb.or([eb("senderDeleted", "=", 1), eb("senderId", "is", null)]))
        .execute();
    },
  };

  const watches: Repositories["watches"] = {
    async watch(userId, topicId) {
      await db
        .insertInto("topicWatches")
        .values({ userId, topicId, notified: 0 })
        .onConflict((oc) => oc.columns(["userId", "topicId"]).doNothing())
        .execute();
    },
    async unwatch(userId, topicId) {
      await db
        .deleteFrom("topicWatches")
        .where("userId", "=", userId)
        .where("topicId", "=", topicId)
        .execute();
    },
    async isWatching(userId, topicId) {
      return !!(await db
        .selectFrom("topicWatches")
        .select("userId")
        .where("userId", "=", userId)
        .where("topicId", "=", topicId)
        .executeTakeFirst());
    },
    async takeWatchersToNotify(topicId, except) {
      const rows = await db
        .selectFrom("topicWatches")
        .select("userId")
        .where("topicId", "=", topicId)
        .where("notified", "=", 0)
        .where("userId", "!=", except)
        .execute();
      const ids = rows.map((r) => r.userId);
      if (ids.length)
        await db
          .updateTable("topicWatches")
          .set({ notified: 1 })
          .where("topicId", "=", topicId)
          .where("userId", "in", ids)
          .execute();
      return ids;
    },
    async topicsOf(userId) {
      return (
        await db.selectFrom("topicWatches").select("topicId").where("userId", "=", userId).execute()
      ).map((r) => r.topicId);
    },
    async removeAllFor(userId) {
      await db.deleteFrom("topicWatches").where("userId", "=", userId).execute();
    },
    async visited(userId, topicId) {
      await db
        .updateTable("topicWatches")
        .set({ notified: 0 })
        .where("userId", "=", userId)
        .where("topicId", "=", topicId)
        .where("notified", "=", 1)
        .execute();
    },
  };

  const toInvite = (i: Selectable<Schema["invites"]>): Invite => ({
    id: i.id,
    codeHash: i.codeHash,
    createdBy: i.createdBy,
    createdAt: n(i.createdAt),
    expiresAt: i.expiresAt === null ? null : n(i.expiresAt),
    usesLeft: i.usesLeft,
    note: i.note,
  });
  const invites: Repositories["invites"] = {
    async create(i) {
      const row = {
        codeHash: i.codeHash,
        createdBy: i.createdBy,
        createdAt: i.createdAt ?? Date.now(),
        expiresAt: i.expiresAt,
        usesLeft: i.usesLeft,
        note: i.note,
      };
      const { id } = await db.insertInto("invites").values(row).returning("id").executeTakeFirstOrThrow();
      return toInvite({ id, ...row });
    },
    async usable(codeHash, now) {
      const r = await db
        .selectFrom("invites")
        .selectAll()
        .where("codeHash", "=", codeHash)
        .where("usesLeft", ">", 0)
        .where((eb) => eb.or([eb("expiresAt", "is", null), eb("expiresAt", ">", now)]))
        .executeTakeFirst();
      return r && toInvite(r);
    },
    async consume(id) {
      const r = await db
        .updateTable("invites")
        .set({ usesLeft: sql<number>`uses_left - 1` })
        .where("id", "=", id)
        .where("usesLeft", ">", 0)
        .executeTakeFirst();
      return Number(r.numUpdatedRows) === 1;
    },
    async list() {
      return (await db.selectFrom("invites").selectAll().orderBy("createdAt", "desc").execute()).map(
        toInvite,
      );
    },
    async remove(id) {
      await db.deleteFrom("invites").where("id", "=", id).execute();
    },
  };

  const sqlite = dialect === "sqlite";
  const search: Repositories["search"] = {
    async index(docs) {
      if (!docs.length) return;
      await search.remove(docs.map((d) => d.postId));
      for (const d of docs) {
        await db
          .insertInto("searchMeta")
          .values({
            postId: d.postId,
            topicId: d.topicId,
            nodeId: d.nodeId,
            authorId: d.authorId,
            createdAt: d.createdAt,
          })
          .execute();
        if (sqlite)
          await sql`insert into search_fts (rowid, title, body) values (${d.postId}, ${d.title}, ${d.body})`.execute(
            db,
          );
        else
          await sql`update search_meta set document = setweight(to_tsvector('simple', ${d.title}), 'A') || to_tsvector('simple', ${d.body}) where post_id = ${d.postId}`.execute(
            db,
          );
      }
    },
    async remove(postIds) {
      if (!postIds.length) return;
      if (sqlite) await sql`delete from search_fts where rowid in (${sql.join(postIds)})`.execute(db);
      await db.deleteFrom("searchMeta").where("postId", "in", postIds).execute();
    },
    async forgetAuthor(authorId) {
      await db.updateTable("searchMeta").set({ authorId: null }).where("authorId", "=", authorId).execute();
    },
    async clear() {
      if (sqlite) await sql`delete from search_fts`.execute(db);
      await db.deleteFrom("searchMeta").execute();
    },
    async query(q) {
      const terms = q.terms.filter((t) => /^[a-z0-9]+$/.test(t));
      if (!terms.length || !q.nodeIds.length) return paginate([], 0, q.page);
      // Only folded [a-z0-9] words reach here, so the match expressions can't be injected.
      const match = sqlite
        ? sql`m.post_id in (select rowid from search_fts where search_fts match ${terms.map((t) => `"${t}"*`).join(" ")})`
        : sql`m.document @@ to_tsquery('simple', ${terms.map((t) => `${t}:*`).join(" & ")})`;
      const base = sql`from search_meta m
        join posts p on p.id = m.post_id and p.visibility = 'core:public'
        join topics t on t.id = m.topic_id and t.visibility = 'core:public'
        where ${match} and m.node_id in (${sql.join(q.nodeIds)})
        ${q.authorId != null ? sql`and m.author_id = ${q.authorId}` : sql``}`;
      // Like phpBB2, results stop at SEARCH_RESULTS_MAX: counting 50,000 matches costs more
      // than anyone reads. The count says "more" with SEARCH_RESULTS_MAX + 1.
      const total = await sql<{
        c: number;
      }>`select count(*) as c from (select 1 ${base} limit ${SEARCH_RESULTS_MAX + 1}) x`.execute(db);
      // "pid", not post_id: the CamelCasePlugin renames result columns of raw queries too.
      const rows = await sql<{
        pid: number;
      }>`select m.post_id as pid ${base} order by m.created_at desc, m.post_id desc limit ${q.page.perPage} offset ${offset(q.page)}`.execute(
        db,
      );
      return paginate(
        rows.rows.map((r) => Number(r.pid)),
        n(total.rows[0]?.c ?? 0),
        q.page,
      );
    },
  };

  const polls: Repositories["polls"] = {
    async create(p) {
      const { id } = await db
        .insertInto("polls")
        .values({
          ...(p.id !== undefined ? { id: p.id } : {}),
          topicId: p.topicId,
          question: p.question,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          hideResults: p.hideResults ? 1 : 0,
          createdAt: Date.now(),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      if (p.options.length)
        await db
          .insertInto("pollOptions")
          .values(p.options.map((o) => ({ pollId: id, position: o.position, text: o.text, votes: o.votes })))
          .execute();
      return (await polls.forTopic(p.topicId))!;
    },
    async forTopic(topicId) {
      const p = await db.selectFrom("polls").selectAll().where("topicId", "=", topicId).executeTakeFirst();
      if (!p) return undefined;
      const options = await db
        .selectFrom("pollOptions")
        .select(["position", "text", "votes"])
        .where("pollId", "=", p.id)
        .orderBy("position")
        .execute();
      const voters = await db
        .selectFrom("pollVoters")
        .select((eb) => eb.fn.countAll().as("c"))
        .where("pollId", "=", p.id)
        .executeTakeFirstOrThrow();
      return {
        id: p.id,
        topicId: p.topicId,
        question: p.question,
        startsAt: n(p.startsAt),
        endsAt: p.endsAt === null ? null : n(p.endsAt),
        hideResults: !!p.hideResults,
        options: options.map((o) => ({ position: o.position, text: o.text, votes: o.votes })),
        voterCount: n(voters.c),
      };
    },
    async addVoters(pollId, userIds) {
      const ids = [...new Set(userIds)];
      if (!ids.length) return;
      await db
        .insertInto("pollVoters")
        .values(ids.map((userId) => ({ pollId, userId })))
        .onConflict((oc) => oc.columns(["pollId", "userId"]).doNothing())
        .execute();
    },
  };

  const smilies: Repositories["smilies"] = {
    async create(s) {
      const { id } = await db
        .insertInto("smilies")
        .values({
          ...(s.id !== undefined ? { id: s.id } : {}),
          code: s.code,
          image: s.image,
          emotion: s.emotion,
          position: s.position,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { ...s, id };
    },
    async all() {
      const rows = await db.selectFrom("smilies").selectAll().orderBy("position").orderBy("id").execute();
      return rows.map(
        (r): Smiley => ({ id: r.id, code: r.code, image: r.image, emotion: r.emotion, position: r.position }),
      );
    },
  };

  const sessions: Repositories["sessions"] = {
    async create(session) {
      await db.insertInto("sessions").values(session).execute();
    },
    async get(id) {
      const r = await db.selectFrom("sessions").selectAll().where("id", "=", id).executeTakeFirst();
      return r && toSession(r);
    },
    async touch(id, lastSeenAt, expiresAt) {
      await db.updateTable("sessions").set({ lastSeenAt, expiresAt }).where("id", "=", id).execute();
    },
    async remove(id) {
      await db.deleteFrom("sessions").where("id", "=", id).execute();
    },
    async removeForUser(userId, keep) {
      let q = db.deleteFrom("sessions").where("userId", "=", userId);
      if (keep !== undefined) q = q.where("id", "!=", keep);
      const r = await q.executeTakeFirst();
      return Number(r.numDeletedRows);
    },
    async listForUser(userId) {
      const rows = await db
        .selectFrom("sessions")
        .selectAll()
        .where("userId", "=", userId)
        .orderBy("lastSeenAt", "desc")
        .execute();
      return rows.map(toSession);
    },
    async activeUserIds(since, now) {
      const rows = await db
        .selectFrom("sessions")
        .select("userId")
        .select((eb) => eb.fn.max("lastSeenAt").as("seen"))
        .where("lastSeenAt", ">=", since)
        .where("expiresAt", ">", now)
        .groupBy("userId")
        .orderBy("seen", "desc")
        .execute();
      return rows.map((r) => r.userId);
    },
    async purgeExpired(now) {
      const r = await db.deleteFrom("sessions").where("expiresAt", "<=", now).executeTakeFirst();
      return Number(r.numDeletedRows);
    },
  };

  const emailTokens: Repositories["emailTokens"] = {
    async create(t) {
      await db
        .insertInto("emailTokens")
        .values({ ...t, usedAt: null, targetEmail: t.targetEmail ?? null })
        .execute();
    },
    async peek(tokenHash, purpose, now) {
      const r = await db
        .selectFrom("emailTokens")
        .select(["userId", "targetEmail"])
        .where("tokenHash", "=", tokenHash)
        .where("purpose", "=", purpose)
        .where("usedAt", "is", null)
        .where("expiresAt", ">", now)
        .executeTakeFirst();
      return r && { userId: n(r.userId), targetEmail: r.targetEmail };
    },
    async consume(tokenHash, purpose, now) {
      const row = await db
        .updateTable("emailTokens")
        .set({ usedAt: now, targetEmail: null })
        .where("tokenHash", "=", tokenHash)
        .where("purpose", "=", purpose)
        .where("usedAt", "is", null)
        .where("expiresAt", ">", now)
        .returning("userId")
        .executeTakeFirst();
      return row && n(row.userId);
    },
    async revoke(userId, purpose, now) {
      await db
        .updateTable("emailTokens")
        .set({ usedAt: now, targetEmail: null })
        .where("userId", "=", userId)
        .where("purpose", "=", purpose)
        .where("usedAt", "is", null)
        .execute();
    },
    async lastIssued(userId, purpose) {
      const r = await db
        .selectFrom("emailTokens")
        .select((eb) => eb.fn.max("createdAt").as("at"))
        .where("userId", "=", userId)
        .where("purpose", "=", purpose)
        .executeTakeFirst();
      return r?.at == null ? undefined : n(r.at);
    },
    async purgeExpired(now) {
      const result = await db.deleteFrom("emailTokens").where("expiresAt", "<=", now).executeTakeFirst();
      return Number(result.numDeletedRows);
    },
  };

  const jobs: Repositories["jobs"] = {
    async enqueue(type, payload, opts) {
      const now = Date.now();
      const { id } = await db
        .insertInto("jobs")
        .values({
          type,
          payload: JSON.stringify(payload ?? {}),
          status: "queued",
          runAt: opts?.runAt ?? now,
          attempts: 0,
          maxAttempts: opts?.maxAttempts ?? 5,
          lockedBy: null,
          lockedUntil: null,
          lastError: "",
          createdAt: now,
          finishedAt: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return n(id);
    },
    async claim(types, workerId, now, leaseMs) {
      if (!types.length) return undefined;
      // Optimistic claim, portable across engines: pick candidates, then take one with a
      // conditional UPDATE. Losing a race just means trying the next candidate.
      const due = (eb: ExpressionBuilder<Schema, "jobs">) =>
        eb.or([
          eb.and([eb("status", "=", "queued"), eb("runAt", "<=", now)]),
          eb.and([eb("status", "=", "running"), eb("lockedUntil", "<", now)]),
        ]);
      const candidates = await db
        .selectFrom("jobs")
        .select("id")
        .where("type", "in", types)
        .where(due)
        .orderBy("runAt")
        .orderBy("id")
        .limit(5)
        .execute();
      for (const { id } of candidates) {
        const r = await db
          .updateTable("jobs")
          .set((eb) => ({
            status: "running",
            lockedBy: workerId,
            lockedUntil: now + leaseMs,
            attempts: eb("attempts", "+", 1),
          }))
          .where("id", "=", id)
          .where(due)
          .executeTakeFirst();
        if (Number(r.numUpdatedRows) === 1) return jobs.get(n(id));
      }
      return undefined;
    },
    async complete(id, now) {
      await db
        .updateTable("jobs")
        // Payloads can hold secrets (a mail job carries a one-time link); drop them when done.
        .set({ status: "done", finishedAt: now, lockedBy: null, lockedUntil: null, payload: "{}" })
        .where("id", "=", id)
        .execute();
    },
    async fail(id, error, now, retryAt) {
      await db
        .updateTable("jobs")
        .set({
          status: retryAt === null ? "failed" : "queued",
          runAt: retryAt ?? now,
          finishedAt: retryAt === null ? now : null,
          lastError: error.slice(0, 2000),
          lockedBy: null,
          lockedUntil: null,
          ...(retryAt === null ? { payload: "{}" } : {}),
        })
        .where("id", "=", id)
        .execute();
    },
    async get(id) {
      const r = await db.selectFrom("jobs").selectAll().where("id", "=", id).executeTakeFirst();
      return r && toJob(r);
    },
    async purgeFinished(before) {
      const r = await db
        .deleteFrom("jobs")
        .where("status", "in", ["done", "failed"])
        .where("finishedAt", "<", before)
        .executeTakeFirst();
      return Number(r.numDeletedRows);
    },
  };

  const throttle: Repositories["throttle"] = {
    async get(key) {
      const r = await db.selectFrom("throttle").selectAll().where("key", "=", key).executeTakeFirst();
      return r && { failures: n(r.failures), last: n(r.last) };
    },
    async put(key, failures, last) {
      await db
        .insertInto("throttle")
        .values({ key, failures, last })
        .onConflict((oc) => oc.column("key").doUpdateSet({ failures, last }))
        .execute();
    },
    async increment(key, now, windowMs) {
      await db
        .insertInto("throttle")
        .values({ key, failures: 1, last: now })
        .onConflict((oc) =>
          oc.column("key").doUpdateSet((eb) => ({
            failures: eb
              .case()
              .when("throttle.last", "<", now - windowMs)
              .then(1)
              .else(eb("throttle.failures", "+", 1))
              .end(),
            last: eb.case().when("throttle.last", "<", now).then(now).else(eb.ref("throttle.last")).end(),
          })),
        )
        .execute();
    },
    async remove(key) {
      await db.deleteFrom("throttle").where("key", "=", key).execute();
    },
    async purge(before) {
      const r = await db.deleteFrom("throttle").where("last", "<", before).executeTakeFirst();
      return Number(r.numDeletedRows);
    },
  };

  return {
    nodes,
    topics,
    posts,
    users,
    credentials,
    sessions,
    emailTokens,
    jobs,
    throttle,
    groups,
    roles,
    grants,
    legacyIds,
    slugs,
    audit,
    ranks,
    smilies,
    polls,
    bans,
    messages,
    watches,
    search,
    invites,
    raw: db.withoutPlugins(),
    transaction: (fn) =>
      db.isTransaction
        ? fn(createRepositories(db, dialect))
        : db.transaction().execute((trx) => fn(createRepositories(trx, dialect))),
  };
}

export { idsOf };
