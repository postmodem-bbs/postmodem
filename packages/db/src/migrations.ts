// SPDX-License-Identifier: AGPL-3.0-or-later
// Migrations are embedded as code so they survive bundling into the runtime image.
// Rules (CONTAINERS.md §4.4): append only; expand/contract; never edit a released migration.

export interface Migration {
  id: string;
  sqlite: string;
  pg: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: "0001_settings",
    sqlite: `
      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
    pg: `
      CREATE TABLE settings (
        key        text PRIMARY KEY,
        value      jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );`,
  },
];

export const MIGRATIONS_TABLE = {
  sqlite: `CREATE TABLE IF NOT EXISTS pm_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
  pg: `CREATE TABLE IF NOT EXISTS pm_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
};

/** Arbitrary constant for pg_advisory_lock, so concurrent `postmodem migrate` runs serialise. */
export const PG_MIGRATION_LOCK = 7_270_011;
