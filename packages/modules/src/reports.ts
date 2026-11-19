// SPDX-License-Identifier: AGPL-3.0-or-later
// reports (tier 2, PACKAGES.md §2.5): members report a post with a reason; moderators of its
// forum see a count in the header, work through a queue and close each report with an
// outcome. Przemo's report.php is the URL (apps/server/src/routes/report.php). Importing
// Przemo's report_* data arrives with importer slices (extension point #12, M2b).
import {
  defineChannel,
  type Id,
  type Millis,
  type PackageDefinition,
  type Permissions,
  type Repositories,
} from "@postmodem/core";
import type { Kysely } from "kysely";

export const REPORT_REASON_MAX = 1000;
/** Live updates of the queue (the header count), for whoever handles reports somewhere. */
export const REPORTS_CHANNEL = "reports.queue";

interface ReportsTable {
  id: number;
  post_id: number;
  reporter_id: number;
  reason: string;
  status: string;
  outcome: string;
  created_at: number;
  closed_by: number | null;
  closed_at: number | null;
}
type Db = Kysely<{ pm_reports: ReportsTable }>;

export interface Report {
  id: Id;
  postId: Id;
  reporterId: Id;
  reason: string;
  status: "open" | "closed";
  outcome: string;
  createdAt: Millis;
  closedBy: Id | null;
  closedAt: Millis | null;
}

const toReport = (r: ReportsTable): Report => ({
  id: Number(r.id),
  postId: Number(r.post_id),
  reporterId: Number(r.reporter_id),
  reason: r.reason,
  status: r.status === "closed" ? "closed" : "open",
  outcome: r.outcome,
  createdAt: Number(r.created_at),
  closedBy: r.closed_by === null ? null : Number(r.closed_by),
  closedAt: r.closed_at === null ? null : Number(r.closed_at),
});

/** The package's own store; the routes in apps/server use it through `reportsStore(ctx.db)`. */
export function reportsStore(raw: unknown) {
  const db = raw as Db;
  return {
    async create(r: { postId: Id; reporterId: Id; reason: string; now?: Millis }) {
      const row = await db
        .insertInto("pm_reports")
        .values({
          post_id: r.postId,
          reporter_id: r.reporterId,
          reason: r.reason,
          status: "open",
          outcome: "",
          created_at: r.now ?? Date.now(),
          closed_by: null,
          closed_at: null,
        } as never)
        .returningAll()
        .executeTakeFirstOrThrow();
      return toReport(row);
    },
    async get(id: Id) {
      const row = await db.selectFrom("pm_reports").selectAll().where("id", "=", id).executeTakeFirst();
      return row && toReport(row);
    },
    /** An open report of this post by this member already (one is enough). */
    async openBy(postId: Id, reporterId: Id) {
      const row = await db
        .selectFrom("pm_reports")
        .selectAll()
        .where("post_id", "=", postId)
        .where("reporter_id", "=", reporterId)
        .where("status", "=", "open")
        .executeTakeFirst();
      return row && toReport(row);
    },
    async open(limit = 500) {
      const rows = await db
        .selectFrom("pm_reports")
        .selectAll()
        .where("status", "=", "open")
        .orderBy("created_at")
        .limit(limit)
        .execute();
      return rows.map(toReport);
    },
    async close(id: Id, by: Id, outcome: string, now = Date.now()) {
      await db
        .updateTable("pm_reports")
        .set({ status: "closed", outcome, closed_by: by, closed_at: now })
        .where("id", "=", id)
        .execute();
    },
  };
}
export type ReportsStore = ReturnType<typeof reportsStore>;

/** Open reports in forums the viewer may handle, with their posts (the queue and the badge). */
export async function reportsFor(store: ReportsStore, repos: Repositories, perms: Permissions) {
  const open = await store.open();
  if (!open.length) return [];
  const posts = await repos.posts.getMany(open.map((r) => r.postId));
  const nodes = new Map((await repos.nodes.tree()).map((n) => [n.id, n]));
  return open.flatMap((r) => {
    const post = posts.get(r.postId);
    const node = post && nodes.get(post.nodeId);
    return post && node && perms.can("moderate.reports", node) ? [{ report: r, post, node }] : [];
  });
}

export const reports: PackageDefinition = {
  key: "reports",
  name: "Reports",
  description: "Members report posts; moderators work through a queue.",
  tier: 2,
  version: "0.1.0",
  capabilities: [
    {
      key: "reports.create",
      scope: "node",
      requires: ["node.read"],
      description: "Report posts to the moderators",
      roles: { "core:participant": "allow", "core:moderator": "allow" },
    },
    // Under moderate.*: every moderator role that allows moderate.* handles reports too.
    { key: "moderate.reports", scope: "node", requires: ["node.read"], description: "See and close reports" },
  ],
  channels: [
    defineChannel({
      key: REPORTS_CHANNEL,
      scope: "board",
      // Payloads say only "changed"; the page then reloads its own, permission-checked count.
      subscribe: async (perms, _scope, repos) =>
        perms.viewer.userId !== null && perms.filter("moderate.reports", await repos.nodes.tree()).length > 0,
    }),
  ],
  migrations: (dialect) => ({
    "0001_reports": {
      async up(db: Kysely<unknown>) {
        await db.schema
          .createTable("pm_reports")
          .addColumn("id", dialect === "sqlite" ? "integer" : "bigint", (c) =>
            dialect === "sqlite"
              ? c.primaryKey().autoIncrement()
              : c.primaryKey().generatedByDefaultAsIdentity(),
          )
          .addColumn("post_id", "bigint", (c) => c.notNull())
          .addColumn("reporter_id", "bigint", (c) => c.notNull())
          .addColumn("reason", "text", (c) => c.notNull())
          .addColumn("status", "text", (c) => c.notNull())
          .addColumn("outcome", "text", (c) => c.notNull().defaultTo(""))
          .addColumn("created_at", "bigint", (c) => c.notNull())
          .addColumn("closed_by", "bigint")
          .addColumn("closed_at", "bigint")
          .execute();
        await db.schema
          .createIndex("pm_reports_status")
          .on("pm_reports")
          .columns(["status", "created_at"])
          .execute();
        await db.schema.createIndex("pm_reports_post").on("pm_reports").column("post_id").execute();
      },
    },
  }),
  setup: (ctx) => {
    const store = reportsStore(ctx.db);
    return {
      slots: {
        "post.actions": ({ user, perms, node, post }) =>
          user && node && post && post.authorId !== user.id && perms.can("reports.create", node)
            ? [{ kind: "link", key: "report", label: "reports-report", href: `/report.php?p=${post.id}` }]
            : [],
        "header.badges": async ({ user, perms }) => {
          if (!user) return [];
          const count = (await reportsFor(store, ctx.repos, perms)).length;
          return count
            ? [
                {
                  kind: "link",
                  key: "reports",
                  label: "reports-queue",
                  href: "/report.php?mode=queue",
                  count,
                },
              ]
            : [];
        },
      },
    };
  },
};
