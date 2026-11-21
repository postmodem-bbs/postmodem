// SPDX-License-Identifier: AGPL-3.0-or-later
// A Postgres introspector that only looks at the connection's own schema (#115).
//
// Kysely's stock PostgresIntrospector lists the tables of *every* schema on the server and
// calls pg_get_serial_sequence('<schema>.<table>', …) for each column. If another client
// drops a schema while that query runs, the function fails with `schema "…" does not exist`.
// Kysely's Migrator calls getTables() on every migrate(), so boards (or test databases) that
// share one Postgres server under different schemas could fail to start whenever one of them
// dropped its schema. A board only ever needs its own schema, so this introspector reads
// nothing else.
import {
  type DatabaseIntrospector,
  type DatabaseMetadataOptions,
  type Kysely,
  type SchemaMetadata,
  sql,
  type TableMetadata,
} from "kysely";
import { DEFAULT_MIGRATION_LOCK_TABLE, DEFAULT_MIGRATION_TABLE } from "kysely/migration";

interface ColumnRow {
  table: string;
  tableType: string;
  schema: string;
  column: string;
  notNull: boolean;
  hasDefault: boolean;
  type: string;
  typeSchema: string;
  comment: string | null;
  autoIncrementing: string | null;
}

export class SchemaScopedPostgresIntrospector implements DatabaseIntrospector {
  readonly #db: Kysely<unknown>;

  constructor(db: Kysely<unknown>) {
    this.#db = db;
  }

  async getSchemas(): Promise<SchemaMetadata[]> {
    // Names only: nothing here dereferences another schema's objects.
    const { rows } = await sql<{ name: string }>`
      select nspname as name from pg_catalog.pg_namespace
      where nspname !~ '^pg_' and nspname <> 'information_schema'
    `.execute(this.#db);
    return rows.map(({ name }) => ({ name }));
  }

  async getTables(
    options: DatabaseMetadataOptions = { withInternalKyselyTables: false },
  ): Promise<TableMetadata[]> {
    const { rows } = await sql<ColumnRow>`
      select c.relname as "table", c.relkind as "tableType", ns.nspname as "schema",
        a.attname as "column", a.attnotnull as "notNull", a.atthasdef as "hasDefault",
        typ.typname as "type", dtns.nspname as "typeSchema",
        col_description(a.attrelid, a.attnum) as "comment",
        pg_get_serial_sequence(quote_ident(ns.nspname) || '.' || quote_ident(c.relname), a.attname)
          as "autoIncrementing"
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c on a.attrelid = c.oid
      join pg_catalog.pg_namespace ns on c.relnamespace = ns.oid
      join pg_catalog.pg_type typ on a.atttypid = typ.oid
      join pg_catalog.pg_namespace dtns on typ.typnamespace = dtns.oid
      where ns.nspname = current_schema()
        and c.relkind in ('r', 'v', 'p', 'f')
        and a.attnum >= 0 and not a.attisdropped
      order by c.relname, a.attnum
    `.execute(this.#db);
    const internal = new Set([DEFAULT_MIGRATION_TABLE, DEFAULT_MIGRATION_LOCK_TABLE]);
    const tables = new Map<string, TableMetadata>();
    for (const row of rows) {
      if (!options.withInternalKyselyTables && internal.has(row.table)) continue;
      let table = tables.get(row.table);
      if (!table) {
        table = {
          name: row.table,
          schema: row.schema,
          isView: row.tableType === "v",
          isForeign: row.tableType === "f",
          columns: [],
        };
        tables.set(row.table, table);
      }
      table.columns.push({
        name: row.column,
        dataType: row.type,
        dataTypeSchema: row.typeSchema,
        isNullable: !row.notNull,
        isAutoIncrementing: row.autoIncrementing !== null,
        hasDefaultValue: row.hasDefault,
        ...(row.comment === null ? {} : { comment: row.comment }),
      });
    }
    return [...tables.values()];
  }
}
