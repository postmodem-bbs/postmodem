// SPDX-License-Identifier: AGPL-3.0-or-later
// SQLite via Node's built-in `node:sqlite` (no native addon in the image), wired into
// Drizzle through its generic sqlite-proxy driver.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SettingsStore } from "@postmodem/core";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import type { Database } from "./database.ts";
import { MIGRATIONS, MIGRATIONS_TABLE } from "./migrations.ts";
import { sqliteSettings } from "./schema.ts";

export function openSqlite(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

  type Row = Record<string, unknown>;
  const orm = drizzle(async (sql, params, method) => {
    const stmt = db.prepare(sql);
    const args = params as never[];
    if (method === "run") {
      stmt.run(...args);
      return { rows: [] };
    }
    if (method === "get") {
      const row = stmt.get(...args) as Row | undefined;
      return { rows: row ? (Object.values(row) as never) : (undefined as never) };
    }
    const rows = stmt.all(...args) as Row[];
    return { rows: rows.map((r) => Object.values(r)) };
  });

  const applied = () =>
    new Set((db.prepare("SELECT id FROM pm_migrations").all() as { id: string }[]).map((r) => r.id));

  const settings: SettingsStore = {
    async loadAll() {
      const rows = await orm.select().from(sqliteSettings);
      return new Map(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
    },
    async save(key, value) {
      const now = new Date().toISOString();
      const json = JSON.stringify(value);
      await orm
        .insert(sqliteSettings)
        .values({ key, value: json, updatedAt: now })
        .onConflictDoUpdate({ target: sqliteSettings.key, set: { value: json, updatedAt: now } });
    },
  };

  return {
    dialect: "sqlite",
    async ping() {
      db.prepare("SELECT 1").get();
    },
    async pendingMigrations() {
      db.exec(MIGRATIONS_TABLE.sqlite);
      const done = applied();
      return MIGRATIONS.filter((m) => !done.has(m.id)).map((m) => m.id);
    },
    async migrate() {
      db.exec(MIGRATIONS_TABLE.sqlite);
      const ran: string[] = [];
      // BEGIN IMMEDIATE takes the write lock, so concurrent starts serialise.
      db.exec("BEGIN IMMEDIATE");
      try {
        const done = applied();
        for (const m of MIGRATIONS) {
          if (done.has(m.id)) continue;
          db.exec(m.sqlite);
          db.prepare("INSERT INTO pm_migrations (id, applied_at) VALUES (?, ?)").run(
            m.id,
            new Date().toISOString(),
          );
          ran.push(m.id);
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return ran;
    },
    settingsStore: () => settings,
    async close() {
      db.close();
    },
  };
}
