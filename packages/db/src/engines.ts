// SPDX-License-Identifier: AGPL-3.0-or-later
// Kysely engines: node:sqlite (built into Node 24, no native addon) and postgres.js.
// PGlite (tests) lives in testing.ts so it never ends up in the production bundle.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CamelCasePlugin, Kysely, SqliteDialect } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import type { Dialect } from "./migrations.ts";
import type { Schema } from "./schema.ts";

export interface Engine {
  dialect: Dialect;
  db: Kysely<Schema>;
}

const plugins = [new CamelCasePlugin()];

/** Adapts node:sqlite to Kysely's SqliteDatabase contract (array parameters + `reader` flag). */
function nodeSqliteAdapter(db: DatabaseSync) {
  return {
    close: () => db.close(),
    prepare(text: string) {
      const st = db.prepare(text);
      return {
        reader: st.columns().length > 0,
        all: (p: readonly unknown[]) => st.all(...(p as never[])),
        run: (p: readonly unknown[]) => st.run(...(p as never[])),
        iterate: (p: readonly unknown[]) => st.iterate(...(p as never[])),
      };
    },
  };
}

export function sqliteEngine(path: string): Engine {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return {
    dialect: "sqlite",
    db: new Kysely<Schema>({ dialect: new SqliteDialect({ database: nodeSqliteAdapter(raw) }), plugins }),
  };
}

/** Postgres int8 (ids, counts, epoch-millisecond timestamps) as JS numbers; all values fit in 2^53. */
const INT8 = { to: 20, from: [20], serialize: (v: number) => String(v), parse: (v: string) => Number(v) };

export function postgresEngine(url: string, password?: string): Engine {
  const client = postgres(url, {
    ...(password ? { password } : {}),
    max: 10,
    onnotice: () => {},
    types: { int8: INT8 } as never,
  });
  return {
    dialect: "pg",
    db: new Kysely<Schema>({ dialect: new PostgresJSDialect({ postgres: client }), plugins }),
  };
}
