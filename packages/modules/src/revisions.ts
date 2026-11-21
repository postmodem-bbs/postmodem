// SPDX-License-Identifier: AGPL-3.0-or-later
// revisions (tier 2, PACKAGES.md §2.2; Przemo's posts_text_history): every edit keeps the text
// it replaced, written in the edit's own transaction (extension point #3, in-transaction hook),
// so a post's history can't miss an edit or record one that didn't happen. Moderators (and,
// if the board allows, authors) read a post's earlier versions. Old versions can expire after
// `revisions.keepDays`. Importing Przemo's history:
// an importer slice in the Beta phase (#110, ADR 0024).
import {
  defineSetting,
  type Id,
  type Millis,
  type Node,
  type PackageDefinition,
  type Permissions,
} from "@postmodem/core";
import type { Kysely } from "kysely";
import { z } from "zod";

/** Days to keep earlier versions; 0 keeps them forever (Przemo's ph_days). */
export const revisionsKeepDays = defineSetting({
  key: "revisions.keepDays",
  schema: z.number().int().min(0).max(36500),
  default: 0,
});
/** Authors may read their own posts' history too (moderators always may). */
export const revisionsAuthorsSee = defineSetting({
  key: "revisions.authorsSee",
  schema: z.boolean(),
  default: true,
});

interface RevisionsTable {
  id: number;
  post_id: number;
  subject: string;
  body: string;
  /** Who made the edit that replaced this text. */
  edited_by: number | null;
  /** When this text was replaced. */
  replaced_at: number;
}
type Db = Kysely<{ pm_revisions: RevisionsTable }>;

export interface Revision {
  id: Id;
  postId: Id;
  subject: string;
  body: string;
  editedBy: Id | null;
  replacedAt: Millis;
}
const toRevision = (r: RevisionsTable): Revision => ({
  id: Number(r.id),
  postId: Number(r.post_id),
  subject: r.subject,
  body: r.body,
  editedBy: r.edited_by === null ? null : Number(r.edited_by),
  replacedAt: Number(r.replaced_at),
});

export function revisionsStore(raw: unknown) {
  const db = raw as Db;
  return {
    async add(r: { postId: Id; subject: string; body: string; editedBy: Id | null; replacedAt: Millis }) {
      await db
        .insertInto("pm_revisions")
        .values({
          post_id: r.postId,
          subject: r.subject,
          body: r.body,
          edited_by: r.editedBy,
          replaced_at: r.replacedAt,
        } as never)
        .execute();
    },
    /** A post's earlier versions, newest first. */
    async forPost(postId: Id): Promise<Revision[]> {
      const rows = await db
        .selectFrom("pm_revisions")
        .selectAll()
        .where("post_id", "=", postId)
        .orderBy("replaced_at", "desc")
        .orderBy("id", "desc")
        .execute();
      return rows.map(toRevision);
    },
    /** How many earlier versions each post has (one query for a page of posts). */
    async counts(postIds: Id[]): Promise<Map<Id, number>> {
      if (!postIds.length) return new Map();
      const rows = await db
        .selectFrom("pm_revisions")
        .select(["post_id", (eb) => eb.fn.countAll<number>().as("n")])
        .where("post_id", "in", postIds)
        .groupBy("post_id")
        .execute();
      return new Map(rows.map((r) => [Number(r.post_id), Number(r.n)]));
    },
    async prune(olderThan: Millis): Promise<number> {
      const r = await db.deleteFrom("pm_revisions").where("replaced_at", "<", olderThan).executeTakeFirst();
      return Number(r.numDeletedRows);
    },
  };
}
export type RevisionsStore = ReturnType<typeof revisionsStore>;

/** May this reader see the history of a post by `authorId` in `node`? */
export function maySeeRevisions(
  perms: Permissions,
  node: Pick<Node, "id" | "path">,
  authorId: Id | null,
  authorsSee: boolean,
) {
  if (perms.can("revisions.view", node)) return true;
  const me = perms.viewer.userId;
  return authorsSee && me !== null && me === authorId && perms.can("node.read", node);
}

export const revisions: PackageDefinition = {
  key: "revisions",
  name: "Revisions",
  description: "Keeps the text every edit replaced; moderators read a post's history.",
  tier: 2,
  version: "0.1.0",
  capabilities: [
    {
      key: "revisions.view",
      scope: "node",
      requires: ["node.read"],
      description: "Read the earlier versions of posts",
      roles: { "core:moderator": "allow" },
    },
  ],
  settings: [revisionsKeepDays, revisionsAuthorsSee],
  migrations: (dialect) => ({
    "0001_revisions": {
      async up(db: Kysely<unknown>) {
        await db.schema
          .createTable("pm_revisions")
          .addColumn("id", dialect === "sqlite" ? "integer" : "bigint", (c) =>
            dialect === "sqlite"
              ? c.primaryKey().autoIncrement()
              : c.primaryKey().generatedByDefaultAsIdentity(),
          )
          .addColumn("post_id", "bigint", (c) => c.notNull())
          .addColumn("subject", "text", (c) => c.notNull().defaultTo(""))
          .addColumn("body", "text", (c) => c.notNull())
          .addColumn("edited_by", "bigint")
          .addColumn("replaced_at", "bigint", (c) => c.notNull())
          .execute();
        await db.schema
          .createIndex("pm_revisions_post")
          .on("pm_revisions")
          .columns(["post_id", "replaced_at"])
          .execute();
        await db.schema.createIndex("pm_revisions_age").on("pm_revisions").column("replaced_at").execute();
      },
    },
  }),
  setup: (ctx) => {
    const store = revisionsStore(ctx.db);
    return {
      content: {
        // In the edit's transaction: the old text is kept exactly when the new one is saved.
        async postUpdated({ before, after, actor, now }, tx) {
          if (before.source === after.source && before.subject === after.subject) return;
          await revisionsStore(tx.raw).add({
            postId: before.id,
            subject: before.subject,
            body: before.source,
            editedBy: actor.id,
            replacedAt: now,
          });
        },
      },
      async postActions({ perms, node }, posts) {
        const authorsSee = ctx.settings.get(revisionsAuthorsSee);
        const visible = node ? posts.filter((p) => maySeeRevisions(perms, node, p.authorId, authorsSee)) : [];
        const counts = await store.counts(visible.map((p) => p.id));
        return new Map(
          [...counts].map(([postId, count]) => [
            postId,
            [
              {
                kind: "link" as const,
                key: "revisions",
                label: "revisions-link",
                href: `/revisions?p=${postId}`,
                count,
              },
            ],
          ]),
        );
      },
      async housekeeping(now) {
        const days = ctx.settings.get(revisionsKeepDays);
        return days ? store.prune(now - days * 86_400_000) : 0;
      },
    };
  },
};
