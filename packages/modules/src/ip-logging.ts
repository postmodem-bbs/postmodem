// SPDX-License-Identifier: AGPL-3.0-or-later
import { isIP } from "node:net";
import type { Id, Millis, PackageDefinition } from "@postmodem/core";
import type { Generated, Kysely } from "kysely";

export const IP_LOG_RETENTION_DAYS = 90;
const retentionMs = IP_LOG_RETENTION_DAYS * 86_400_000;

export interface IpLogEntry {
  userId: Id;
  ip: string;
  at: Millis;
  kind: "sign-in" | "post" | "legacy";
}

interface IpLogRow {
  id: Generated<number>;
  user_id: Id;
  ip: string;
  at: Millis;
  kind: IpLogEntry["kind"];
}

export function ipLogStore(raw: unknown) {
  const db = raw as Kysely<{ pm_ip_log: IpLogRow }>;
  return {
    async add(entry: IpLogEntry) {
      if (!isIP(entry.ip)) return;
      await db
        .insertInto("pm_ip_log")
        .values({ user_id: entry.userId, ip: entry.ip, at: entry.at, kind: entry.kind })
        .execute();
    },
    async forUser(userId: Id, now = Date.now(), limit?: number): Promise<IpLogEntry[]> {
      const query = db
        .selectFrom("pm_ip_log")
        .select(["user_id", "ip", "at", "kind"])
        .where("user_id", "=", userId)
        .where("at", ">=", now - retentionMs)
        .orderBy("at", "desc")
        .orderBy("id", "desc");
      const rows = await (limit === undefined ? query : query.limit(limit)).execute();
      return rows.map((row) => ({
        userId: Number(row.user_id),
        ip: row.ip,
        at: Number(row.at),
        kind: row.kind,
      }));
    },
    async erase(userId: Id) {
      await db.deleteFrom("pm_ip_log").where("user_id", "=", userId).execute();
    },
    async prune(now: Millis) {
      const result = await db
        .deleteFrom("pm_ip_log")
        .where("at", "<", now - retentionMs)
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },
  };
}

export const ipLogging: PackageDefinition = {
  key: "ip-logging",
  name: "IP logging",
  description: "Keeps a time-limited record of members' sign-in and posting addresses for moderation.",
  tier: 2,
  version: "0.1.0",
  personalData: { reads: ["ip"], purpose: "ip-logging-purpose", retentionDays: IP_LOG_RETENTION_DAYS },
  capabilities: [
    { key: "user.viewIp", scope: "global", description: "Read a member's recorded IP addresses" },
  ],
  migrations: (dialect) => ({
    "0001_ip_log": {
      async up(db: Kysely<unknown>) {
        await db.schema
          .createTable("pm_ip_log")
          .addColumn("id", dialect === "sqlite" ? "integer" : "bigint", (column) =>
            dialect === "sqlite"
              ? column.primaryKey().autoIncrement()
              : column.primaryKey().generatedByDefaultAsIdentity(),
          )
          .addColumn("user_id", "bigint", (column) => column.notNull())
          .addColumn("ip", "text", (column) => column.notNull())
          .addColumn("at", "bigint", (column) => column.notNull())
          .addColumn("kind", "text", (column) => column.notNull())
          .execute();
        await db.schema.createIndex("pm_ip_log_member").on("pm_ip_log").columns(["user_id", "at"]).execute();
        await db.schema.createIndex("pm_ip_log_age").on("pm_ip_log").column("at").execute();
      },
    },
  }),
  setup({ repos, db }) {
    const store = ipLogStore(db);
    const record = async (userId: Id, ip: string | undefined, at: Millis, kind: IpLogEntry["kind"]) => {
      if (!ip || !isIP(ip)) return;
      await repos.transaction(async (tx) => {
        if ((await tx.users.get(userId, { forUpdate: true }))?.status === "active")
          await ipLogStore(tx.raw).add({ userId, ip, at, kind });
      });
    };
    return {
      on: {
        "auth.signedIn": ({ actor, now }, request) => record(actor.id, request?.ip, now, "sign-in"),
        "topic.created": ({ actor, post }, request) => record(actor.id, request?.ip, post.createdAt, "post"),
        "post.created": ({ actor, post }, request) => record(actor.id, request?.ip, post.createdAt, "post"),
      },
      privacy: {
        export: (userId) => store.forUser(userId),
        erase: (userId, tx) => ipLogStore(tx.raw).erase(userId),
      },
      housekeeping: (now) => store.prune(now),
    };
  },
};
