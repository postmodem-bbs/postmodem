// SPDX-License-Identifier: AGPL-3.0-or-later
// One implementation of the core repository ports for SQLite and Postgres (ADR 0013).
// Counters (topic/post counts, last posts) are not maintained on every insert here: the
// importer writes in bulk and then calls recount(); posting (M2) will update them incrementally.
import {
  type AuditEntry,
  childPath,
  depthOf,
  type Effect,
  type Grant,
  type Group,
  type GroupKind,
  type Id,
  idsOf,
  type Membership,
  type Node,
  type NodeKind,
  nameKey,
  type Page,
  type PageRequest,
  type PasswordScheme,
  type Post,
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
  type User,
  type UserStatus,
} from "@postmodem/core";
import { type Kysely, type Selectable, sql } from "kysely";
import type { NodesTable, PostsTable, Schema, SessionsTable, TopicsTable, UsersTable } from "./schema.ts";

type Db = Kysely<Schema>;
const PUBLIC = ["core:public"];

/** Run fn in a transaction unless we're already inside one (no nested transactions). */
const atomic = <T>(db: Db, fn: (db: Db) => Promise<T>): Promise<T> =>
  db.isTransaction ? fn(db) : db.transaction().execute((trx) => fn(trx));

const pending = () => `__pending_${Math.random().toString(36).slice(2)}`;

async function uniqueSlug(db: Db, table: "nodes" | "topics", base: string, id: Id, fallback: string) {
  const slug = base || fallback;
  const clash = await db
    .selectFrom(table)
    .select("id")
    .where("slug", "=", slug)
    .where("id", "!=", id)
    .executeTakeFirst();
  return clash ? `${slug}-${id}` : slug;
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

export function createRepositories(db: Db): Repositories {
  const nodes: Repositories["nodes"] = {
    async create(input) {
      return atomic(db, async (db) => {
        const self = createRepositories(db); // queries inside a transaction must use it
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
        const self = createRepositories(db);
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
      const node = await nodes.get(id);
      if (!node) throw new Error(`node ${id} does not exist`);
      return node;
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
        return (await createRepositories(db).topics.get(id))!;
      });
    },
    async get(id) {
      const r = await db.selectFrom("topics").selectAll().where("id", "=", id).executeTakeFirst();
      return r && toTopic(r);
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
  };

  const users: Repositories["users"] = {
    async create(input) {
      const { id } = await db
        .insertInto("users")
        .values({
          ...(input.id !== undefined ? { id: input.id } : {}),
          username: input.username,
          usernameKey: nameKey(input.username),
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
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return (await users.get(id))!;
    },
    async get(id) {
      const r = await db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
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
      const { email, ...rest } = patch;
      await db
        .updateTable("users")
        .set({
          ...rest,
          ...(rest.username !== undefined
            ? { usernameKey: nameKey(rest.username), usernameSkeleton: skeleton(rest.username) }
            : {}),
          ...(email !== undefined ? { email, emailKey: emailKey(email) } : {}),
        })
        .where("id", "=", id)
        .execute();
      const user = await users.get(id);
      if (!user) throw new Error(`user ${id} does not exist`);
      return user;
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
        return (await createRepositories(db).roles.get(id))!;
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
    async purgeExpired(now) {
      const r = await db.deleteFrom("sessions").where("expiresAt", "<=", now).executeTakeFirst();
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
    groups,
    roles,
    grants,
    legacyIds,
    slugs,
    audit,
    ranks,
    smilies,
    transaction: (fn) =>
      db.isTransaction
        ? fn(createRepositories(db))
        : db.transaction().execute((trx) => fn(createRepositories(trx))),
  };
}

export { idsOf };
