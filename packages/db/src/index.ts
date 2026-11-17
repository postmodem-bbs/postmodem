// SPDX-License-Identifier: AGPL-3.0-or-later
import { createDatabase, type Database } from "./database.ts";
import { postgresEngine, sqliteEngine } from "./engines.ts";

export { createDatabase, type Database } from "./database.ts";
export type { Engine } from "./engines.ts";
export { type Dialect, migrations } from "./migrations.ts";
export type { Schema } from "./schema.ts";

/** Open the database named by POSTMODEM_DATABASE_URL (`sqlite:///path` or `postgres://…`). */
export function openDatabase(url: string, opts: { password?: string } = {}): Database {
  if (url.startsWith("sqlite://")) {
    const path = url.slice("sqlite://".length);
    return createDatabase(sqliteEngine(path === "memory" || path === ":memory:" ? ":memory:" : path));
  }
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return createDatabase(postgresEngine(url, opts.password));
  }
  throw new Error(`unsupported database URL: ${url.split(":")[0]}://…`);
}
