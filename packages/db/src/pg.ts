// SPDX-License-Identifier: AGPL-3.0-or-later
// PostgreSQL via postgres-js (production) or PGlite (tests). Both sit behind the same
// small client interface so migrations and repositories are tested against real Postgres.
import type { SettingsStore } from "@postmodem/core";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Database } from "./database.ts";
import { MIGRATIONS, MIGRATIONS_TABLE, PG_MIGRATION_LOCK } from "./migrations.ts";
import { pgSettings } from "./schema.ts";

/** The few raw operations the migration runner needs, on ONE dedicated connection. */
export interface PgSession {
  exec(sql: string): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface PgBackend {
  /** Run fn on a single reserved connection (advisory locks are per connection). */
  withSession<T>(fn: (s: PgSession) => Promise<T>): Promise<T>;
  // biome-ignore lint/suspicious/noExplicitAny: drizzle's PgDatabase generics differ per driver
  orm: PgDatabase<PgQueryResultHKT, any>;
  close(): Promise<void>;
}

export function pgDatabase(backend: PgBackend): Database {
  const settings: SettingsStore = {
    async loadAll() {
      const rows = await backend.orm.select().from(pgSettings);
      return new Map(rows.map((r) => [r.key, r.value]));
    },
    async save(key, value) {
      await backend.orm
        .insert(pgSettings)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({ target: pgSettings.key, set: { value, updatedAt: new Date() } });
    },
  };

  const applied = async (s: PgSession) =>
    new Set((await s.query<{ id: string }>("SELECT id FROM pm_migrations")).map((r) => r.id));

  return {
    dialect: "pg",
    ping: () => backend.withSession(async (s) => void (await s.query("SELECT 1"))),
    pendingMigrations: () =>
      backend.withSession(async (s) => {
        await s.exec(MIGRATIONS_TABLE.pg);
        const done = await applied(s);
        return MIGRATIONS.filter((m) => !done.has(m.id)).map((m) => m.id);
      }),
    migrate: () =>
      backend.withSession(async (s) => {
        await s.exec(MIGRATIONS_TABLE.pg);
        await s.query("SELECT pg_advisory_lock($1)", [PG_MIGRATION_LOCK]);
        try {
          const done = await applied(s);
          const ran: string[] = [];
          for (const m of MIGRATIONS) {
            if (done.has(m.id)) continue;
            await s.exec("BEGIN");
            try {
              await s.exec(m.pg);
              await s.query("INSERT INTO pm_migrations (id) VALUES ($1)", [m.id]);
              await s.exec("COMMIT");
            } catch (e) {
              await s.exec("ROLLBACK");
              throw e;
            }
            ran.push(m.id);
          }
          return ran;
        } finally {
          await s.query("SELECT pg_advisory_unlock($1)", [PG_MIGRATION_LOCK]);
        }
      }),
    settingsStore: () => settings,
    close: () => backend.close(),
  };
}
