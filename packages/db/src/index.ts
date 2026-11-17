// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Database } from "./database.ts";
import { pgDatabase } from "./pg.ts";
import { postgresJsBackend } from "./postgres-js.ts";
import { openSqlite } from "./sqlite.ts";

export type { Database } from "./database.ts";
export { MIGRATIONS } from "./migrations.ts";
export { type PgBackend, type PgSession, pgDatabase } from "./pg.ts";

/** Open the database named by POSTMODEM_DATABASE_URL (`sqlite:///path` or `postgres://…`). */
export function openDatabase(url: string, opts: { password?: string } = {}): Database {
  if (url.startsWith("sqlite://")) {
    const path = url.slice("sqlite://".length);
    return openSqlite(path === "memory" || path === ":memory:" ? ":memory:" : path);
  }
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return pgDatabase(postgresJsBackend(url, opts.password));
  }
  throw new Error(`unsupported database URL: ${url.split(":")[0]}://…`);
}
