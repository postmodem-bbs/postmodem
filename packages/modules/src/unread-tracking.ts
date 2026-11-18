// SPDX-License-Identifier: AGPL-3.0-or-later
// unread-tracking (tier 2, PACKAGES.md §2.4): exact per-member, per-topic unread state, as
// Przemo's read_history did. A topic is unread when its last post is newer than every mark
// that covers it: the member's mark on the topic, on its forum ("mark forum read"), on the
// whole board ("mark all read"), and the horizon (posts older than `unread.days` count as
// read, so a new or imported account doesn't start with years of unread topics).
// Marks are written when a member views a topic. Importing read_history: M2b (#12).
import { defineSetting, type Id, type Millis, type PackageDefinition } from "@postmodem/core";
import { type Kysely, sql } from "kysely";
import { z } from "zod";

export const unreadDays = defineSetting({
  key: "unread.days",
  schema: z.number().int().min(1).max(3650),
  default: 30,
});

interface Tables {
  pm_read_topics: { user_id: number; topic_id: number; read_at: number };
  /** node_id 0: the whole board ("mark all read"). */
  pm_read_nodes: { user_id: number; node_id: number; read_at: number };
}
type Db = Kysely<Tables>;
const DAY = 86_400_000;

export function unreadStore(raw: unknown) {
  const db = raw as Db;
  const upsert = async <T extends keyof Tables>(table: T, row: Tables[T], key: string) => {
    await db
      .insertInto(table)
      .values(row as never)
      .onConflict((oc) =>
        oc
          .columns(["user_id", key] as never)
          .doUpdateSet({ read_at: (row as { read_at: number }).read_at } as never),
      )
      .execute();
  };
  return {
    markTopic: (userId: Id, topicId: Id, at: Millis) =>
      upsert("pm_read_topics", { user_id: userId, topic_id: topicId, read_at: at }, "topic_id"),
    markNode: (userId: Id, nodeId: Id, at: Millis) =>
      upsert("pm_read_nodes", { user_id: userId, node_id: nodeId, read_at: at }, "node_id"),
    async topicMarks(userId: Id, topicIds: Id[]) {
      if (!topicIds.length) return new Map<Id, Millis>();
      const rows = await db
        .selectFrom("pm_read_topics")
        .select(["topic_id", "read_at"])
        .where("user_id", "=", userId)
        .where("topic_id", "in", topicIds)
        .execute();
      return new Map(rows.map((r) => [Number(r.topic_id), Number(r.read_at)]));
    },
    async nodeMarks(userId: Id) {
      const rows = await db
        .selectFrom("pm_read_nodes")
        .select(["node_id", "read_at"])
        .where("user_id", "=", userId)
        .execute();
      return new Map(rows.map((r) => [Number(r.node_id), Number(r.read_at)]));
    },
    /** Unread topics per forum, in one grouped query (the forum index's badges). */
    async unreadPerNode(userId: Id, nodeIds: Id[], floor: Millis) {
      if (!nodeIds.length) return new Map<Id, number>();
      const rows = await sql<{ node_id: number; n: number }>`
        select t.node_id, count(*) as n
        from topics t
        left join pm_read_topics m on m.topic_id = t.id and m.user_id = ${userId}
        left join pm_read_nodes f on f.node_id = t.node_id and f.user_id = ${userId}
        where t.node_id in (${sql.join(nodeIds)})
          and t.visibility = 'core:public' and t.moved_to_topic_id is null
          and t.last_post_at > ${floor}
          and t.last_post_at > coalesce(f.read_at, 0)
          and t.last_post_at > coalesce(m.read_at, 0)
        group by t.node_id`.execute(db);
      return new Map(rows.rows.map((r) => [Number(r.node_id), Number(r.n)]));
    },
  };
}
export type UnreadStore = ReturnType<typeof unreadStore>;

export const unreadTracking: PackageDefinition = {
  key: "unread-tracking",
  name: "Unread tracking",
  description: "Marks topics and forums with posts a member hasn't read yet.",
  tier: 2,
  version: "0.1.0",
  settings: [unreadDays as never],
  migrations: () => ({
    "0001_read_marks": {
      async up(db: Kysely<unknown>) {
        await db.schema
          .createTable("pm_read_topics")
          .addColumn("user_id", "bigint", (c) => c.notNull())
          .addColumn("topic_id", "bigint", (c) => c.notNull())
          .addColumn("read_at", "bigint", (c) => c.notNull())
          .addPrimaryKeyConstraint("pm_read_topics_pk", ["user_id", "topic_id"])
          .execute();
        await db.schema
          .createTable("pm_read_nodes")
          .addColumn("user_id", "bigint", (c) => c.notNull())
          .addColumn("node_id", "bigint", (c) => c.notNull())
          .addColumn("read_at", "bigint", (c) => c.notNull())
          .addPrimaryKeyConstraint("pm_read_nodes_pk", ["user_id", "node_id"])
          .execute();
      },
    },
  }),
  setup: (ctx) => {
    const store = unreadStore(ctx.db);
    /** Everything up to this moment counts as read for the member, whatever the marks say. */
    const floor = async (userId: Id) => {
      const all = (await store.nodeMarks(userId)).get(0) ?? 0;
      return Math.max(all, Date.now() - ctx.settings.get(unreadDays) * DAY);
    };
    const badge = { badges: [{ key: "unread", label: "unread-new" }], classes: ["pm-unread"] };
    return {
      on: {
        "topic.viewed": async ({ topic, viewer, lastPostAt }) => {
          if (viewer.userId !== null && lastPostAt)
            await store.markTopic(viewer.userId, topic.id, Date.now());
        },
      },
      async decorateTopics(viewer, topics) {
        const out = new Map();
        if (viewer.userId === null || !topics.length) return out;
        const [marks, nodes, min] = await Promise.all([
          store.topicMarks(
            viewer.userId,
            topics.map((t) => t.id),
          ),
          store.nodeMarks(viewer.userId),
          floor(viewer.userId),
        ]);
        for (const t of topics) {
          const last = t.lastPostAt ?? t.createdAt;
          const read = Math.max(min, nodes.get(t.nodeId) ?? 0, marks.get(t.id) ?? 0);
          if (!t.movedToTopicId && last > read) out.set(t.id, badge);
        }
        return out;
      },
      async decorateForums(viewer, nodes) {
        const out = new Map();
        if (viewer.userId === null || !nodes.length) return out;
        const counts = await store.unreadPerNode(
          viewer.userId,
          nodes.filter((n) => n.kind === "forum").map((n) => n.id),
          await floor(viewer.userId),
        );
        for (const [id, n] of counts) if (n > 0) out.set(id, badge);
        return out;
      },
      slots: {
        "forum.tools": ({ user, node }) =>
          user
            ? [
                {
                  kind: "form",
                  key: "mark-read",
                  heading: "",
                  action: `/unread?${node ? `f=${node.id}` : "all=1"}`,
                  fields: [],
                  submit: node ? "unread-mark-forum" : "unread-mark-all",
                },
              ]
            : [],
      },
    };
  },
};
