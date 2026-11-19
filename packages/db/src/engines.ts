// SPDX-License-Identifier: AGPL-3.0-or-later
// Kysely engines: node:sqlite (built into Node 24, no native addon) and postgres.js.
// PGlite (tests) lives in testing.ts so it never ends up in the production bundle.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CamelCasePlugin, CompiledQuery, type Driver, Kysely, SqliteDialect } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import type { Dialect } from "./migrations.ts";
import type { Schema } from "./schema.ts";

export interface Engine {
  dialect: Dialect;
  db: Kysely<Schema>;
}

const plugins = [new CamelCasePlugin()];

/**
 * SQLite transactions that take the write lock when they start (BEGIN IMMEDIATE). A plain
 * BEGIN only reads until the first write; if another process (the CLI next to a running
 * board) writes in between, SQLite can't upgrade the lock and fails at once with "database
 * is locked" instead of waiting (busy_timeout doesn't apply, to avoid a deadlock).
 */
class ImmediateSqliteDialect extends SqliteDialect {
  override createDriver(): Driver {
    const driver = super.createDriver();
    driver.beginTransaction = async (connection) => {
      await connection.executeQuery(CompiledQuery.raw("begin immediate"));
    };
    return driver;
  }
}

/** Prepared statements kept per SQL text; queries are built from a small set of shapes. */
const STATEMENT_CACHE_SIZE = 500;

/**
 * Adapts node:sqlite to Kysely's SqliteDatabase contract (array parameters + `reader` flag).
 * Statements are reused: preparing was ~13% of CPU on a busy board (M1 slice 7). Reuse is
 * safe because node:sqlite runs all() and run() synchronously, start to finish; iterate()
 * (streaming, which can interleave) always gets a fresh statement. SQLite re-prepares a
 * cached statement by itself if a migration changes the schema.
 */
function nodeSqliteAdapter(db: DatabaseSync) {
  type Prepared = { st: ReturnType<DatabaseSync["prepare"]>; reader: boolean };
  const cache = new Map<string, Prepared>();
  const get = (text: string): Prepared => {
    const hit = cache.get(text);
    if (hit) {
      cache.delete(text); // move to the back: least recently used goes first
      cache.set(text, hit);
      return hit;
    }
    const st = db.prepare(text);
    const prepared = { st, reader: st.columns().length > 0 };
    cache.set(text, prepared);
    if (cache.size > STATEMENT_CACHE_SIZE) cache.delete(cache.keys().next().value!);
    return prepared;
  };
  return {
    close: () => {
      cache.clear();
      db.close();
    },
    prepare(text: string) {
      const { st, reader } = get(text);
      return {
        reader,
        all: (p: readonly unknown[]) => st.all(...(p as never[])),
        run: (p: readonly unknown[]) => st.run(...(p as never[])),
        iterate: (p: readonly unknown[]) => db.prepare(text).iterate(...(p as never[])),
      };
    },
  };
}

/** `onQuery` sees every statement's SQL (tests use it to catch N+1 queries). */
export function sqliteEngine(path: string, opts: { onQuery?: (sql: string) => void } = {}): Engine {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return {
    dialect: "sqlite",
    db: new Kysely<Schema>({
      dialect: new ImmediateSqliteDialect({ database: nodeSqliteAdapter(raw) }),
      plugins,
      ...(opts.onQuery ? { log: (e) => opts.onQuery!(e.query.sql) } : {}),
    }),
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
