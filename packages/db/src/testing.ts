// SPDX-License-Identifier: AGPL-3.0-or-later
// Test databases for every engine. Import from "@postmodem/db/testing" in tests only:
// PGlite is a dev dependency and must never be bundled into the server.
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { CamelCasePlugin, Kysely } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import postgres from "postgres";
import { createDatabase, type Database } from "./database.ts";
import { postgresEngine, sqliteEngine } from "./engines.ts";
import type { Schema } from "./schema.ts";

export type TestEngine = "sqlite" | "pglite" | "postgres";

/**
 * Engines to run a suite against: SQLite and PGlite (real Postgres in WASM) always; a real
 * Postgres server too when PM_TEST_PG_URL is set (CI provides one).
 */
export function testEngines(): TestEngine[] {
  return ["sqlite", "pglite", ...(process.env.PM_TEST_PG_URL ? (["postgres"] as const) : [])];
}

export async function openTestDatabase(
  engine: TestEngine,
  opts: { onQuery?: (sql: string) => void } = {},
): Promise<Database> {
  switch (engine) {
    case "sqlite": {
      const dir = mkdtempSync(join(tmpdir(), "pm-test-"));
      return createDatabase(sqliteEngine(join(dir, "test.sqlite"), opts));
    }
    case "pglite": {
      const client = new PGlite({ parsers: { 20: (v: string) => Number(v) } });
      const db = new Kysely<Schema>({ dialect: new PGliteDialect(client), plugins: [new CamelCasePlugin()] });
      return createDatabase({ dialect: "pg", db });
    }
    case "postgres": {
      // One throwaway schema per test database, so tests can run in parallel on one server.
      const url = process.env.PM_TEST_PG_URL!;
      const schema = `t_${randomBytes(6).toString("hex")}`;
      const admin = postgres(url, { max: 1, onnotice: () => {} });
      await admin.unsafe(`create schema ${schema}`);
      await admin.end();
      const sep = url.includes("?") ? "&" : "?";
      const database = createDatabase(postgresEngine(`${url}${sep}search_path=${schema}`));
      const close = database.close;
      database.close = async () => {
        await close();
        const cleanup = postgres(url, { max: 1, onnotice: () => {} });
        await cleanup.unsafe(`drop schema ${schema} cascade`);
        await cleanup.end();
      };
      return database;
    }
  }
}
