// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
  CounterStore,
  DocStore,
  FieldStore,
  PreferenceStore,
  Repositories,
  SettingsStore,
} from "@postmodem/core";
import { type Kysely, sql } from "kysely";
import { type Migration, Migrator } from "kysely/migration";
import type { Engine } from "./engines.ts";
import { type Dialect, migrations } from "./migrations.ts";
import { counterStore, docStore, fieldStore, preferenceStore } from "./platform.ts";
import { createRepositories } from "./repositories.ts";
import { ID_TABLES, type Schema } from "./schema.ts";

export interface Database {
  dialect: Dialect;
  /** Typed query builder, for code that needs more than the repositories offer. */
  kysely: Kysely<Schema>;
  repos: Repositories;
  ping(): Promise<void>;
  /** Names of migrations not yet applied (used by /readyz and `postmodem doctor`). */
  pendingMigrations(): Promise<string[]>;
  /** Apply pending migrations; safe to run concurrently from several containers. */
  migrate(): Promise<string[]>;
  /**
   * Apply packages' migrations (names `<package>/<name>`), kept apart from the core's. Installing
   * a package later adds names that sort before applied ones, so order is per package only.
   */
  migratePackages(migrations: Record<string, Migration>): Promise<string[]>;
  /**
   * A consistent copy of a SQLite database while the board runs (VACUUM INTO). Postgres has
   * pg_dump for that; this refuses rather than pretending.
   */
  backupTo(file: string): Promise<void>;
  /**
   * After inserting rows with explicit (legacy) ids, move Postgres identity sequences past them.
   * No-op on SQLite, where AUTOINCREMENT already follows the highest id.
   */
  syncIdSequences(): Promise<void>;
  settingsStore(): SettingsStore;
  /** Stores behind the platform services (M2b slice 10). */
  platform: { preferences: PreferenceStore; fields: FieldStore; docs: DocStore; counters: CounterStore };
  /**
   * Postgres NOTIFY/LISTEN for the realtime bus; null on SQLite (solo mode is one process,
   * so its bus stays in memory).
   */
  pubsub: {
    notify(channel: string, payload: string): Promise<void>;
    listen(channel: string, onPayload: (payload: string) => void): Promise<() => Promise<void>>;
  } | null;
  close(): Promise<void>;
}

export function createDatabase(engine: Engine): Database {
  const { db, dialect, listen } = engine;
  const all = migrations(dialect);
  let migratorPromise: Promise<Migrator> | undefined;
  /**
   * Kysely's migrator looks for its bookkeeping tables in *every* schema unless told which one,
   * so on Postgres it's pinned to the connection's current schema. Otherwise two boards sharing
   * one database under different schemas would see each other's migration tables.
   */
  const getMigrator = () =>
    (migratorPromise ??= (async () => {
      const raw = db.withoutPlugins() as unknown as Kysely<unknown>;
      const schema =
        dialect === "pg"
          ? (await sql<{ s: string }>`select current_schema() as s`.execute(raw)).rows[0]?.s
          : undefined;
      return new Migrator({
        // Migrations use real (snake_case) names, so they run without the CamelCasePlugin.
        db: raw,
        provider: { getMigrations: async (): Promise<Record<string, Migration>> => all },
        migrationTableName: "pm_schema_migrations",
        migrationLockTableName: "pm_schema_migrations_lock",
        ...(schema ? { migrationTableSchema: schema } : {}),
      });
    })());

  const settings: SettingsStore = {
    async loadAll() {
      // Read as JSON text on both dialects: drivers disagree on whether jsonb arrives parsed.
      const rows = await db
        .selectFrom("settings")
        .select([
          "key",
          sql<string>`${sql.ref("value")}${sql.raw(dialect === "pg" ? "::text" : "")}`.as("json"),
        ])
        .execute();
      return new Map(rows.map((r) => [r.key, JSON.parse(r.json)]));
    },
    async save(key, value) {
      const json = JSON.stringify(value);
      if (dialect === "sqlite") {
        const updatedAt = new Date().toISOString();
        await db
          .insertInto("settings")
          .values({ key, value: json, updatedAt })
          .onConflict((oc) => oc.column("key").doUpdateSet({ value: json, updatedAt }))
          .execute();
      } else {
        // Typed as text first: postgres.js would otherwise JSON-encode a jsonb parameter again.
        const value = sql`cast(cast(${json} as text) as jsonb)`;
        await db
          .insertInto("settings")
          .values({ key, value, updatedAt: sql`now()` })
          .onConflict((oc) => oc.column("key").doUpdateSet({ value, updatedAt: sql`now()` }))
          .execute();
      }
    },
  };

  return {
    dialect,
    kysely: db,
    repos: createRepositories(db, dialect),
    async ping() {
      await sql`select 1`.execute(db);
    },
    async pendingMigrations() {
      return (await (await getMigrator()).getMigrations()).filter((m) => !m.executedAt).map((m) => m.name);
    },
    async migrate() {
      const { error, results } = await (await getMigrator()).migrateToLatest();
      if (error) throw error instanceof Error ? error : new Error(String(error));
      return (results ?? []).filter((r) => r.status === "Success").map((r) => r.migrationName);
    },
    async backupTo(file) {
      if (dialect !== "sqlite")
        throw new Error("online backup is for SQLite; on Postgres use pg_dump (docs/CONTAINERS.md)");
      await sql`vacuum into ${file}`.execute(db);
    },
    async migratePackages(packageMigrations) {
      if (!Object.keys(packageMigrations).length) return [];
      const raw = db.withoutPlugins() as unknown as Kysely<unknown>;
      const schema =
        dialect === "pg"
          ? (await sql<{ s: string }>`select current_schema() as s`.execute(raw)).rows[0]?.s
          : undefined;
      const migrator = new Migrator({
        db: raw,
        provider: { getMigrations: async () => packageMigrations },
        migrationTableName: "pm_package_migrations",
        migrationLockTableName: "pm_package_migrations_lock",
        allowUnorderedMigrations: true,
        ...(schema ? { migrationTableSchema: schema } : {}),
      });
      const { error, results } = await migrator.migrateToLatest();
      if (error) throw error instanceof Error ? error : new Error(String(error));
      return (results ?? []).filter((r) => r.status === "Success").map((r) => r.migrationName);
    },
    async syncIdSequences() {
      if (dialect !== "pg") return;
      for (const table of ID_TABLES) {
        await sql`select setval(pg_get_serial_sequence(${table}, 'id'), coalesce((select max(id) from ${sql.table(table)}), 0) + 1, false)`.execute(
          db.withoutPlugins(),
        );
      }
    },
    settingsStore: () => settings,
    platform: {
      preferences: preferenceStore(db),
      fields: fieldStore(db),
      docs: docStore(db),
      counters: counterStore(db),
    },
    pubsub:
      dialect === "pg" && listen
        ? {
            async notify(channel, payload) {
              await sql`select pg_notify(${channel}, ${payload})`.execute(db);
            },
            listen,
          }
        : null,
    close: () => db.destroy(),
  };
}
