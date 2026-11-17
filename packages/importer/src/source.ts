// SPDX-License-Identifier: AGPL-3.0-or-later
// Reads a phpBB2/Przemo MySQL/MariaDB database (mysql2: pure JS, no native module).
// Text comes back as raw bytes (`character_set_results = binary`): the server must not
// "convert" latin2 that is really cp1250 or UTF-8. charset.ts decides per value.
import { type Connection, createConnection, type RowDataPacket } from "mysql2/promise";

export type Row = Record<string, unknown>;

export interface LegacySource {
  readonly prefix: string;
  tables(): Promise<string[]>;
  columns(table: string): Promise<string[]>;
  /** All rows (small tables). */
  all(table: string, orderBy?: string): Promise<Row[]>;
  /** Rows after `after` by an integer key, in key order, `limit` at a time (big tables). */
  batch(table: string, key: string, after: number, limit: number, where?: string): Promise<Row[]>;
  /** Runs a query whose result is small (joins, counts). */
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  close(): Promise<void>;
}

const IDENT = /^[A-Za-z0-9_]+$/;
const ident = (name: string) => {
  if (!IDENT.test(name)) throw new Error(`unsafe identifier '${name}'`);
  return `\`${name}\``;
};

/** `mysql://user:pass@host:3306/db`; the table prefix is phpBB2's `$table_prefix`. */
export async function openMysqlSource(url: string, prefix = "phpbb_"): Promise<LegacySource> {
  if (!IDENT.test(prefix)) throw new Error(`unsafe table prefix '${prefix}'`);
  const conn: Connection = await createConnection({
    uri: url,
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: true,
  });
  await conn.query("SET character_set_results = binary");
  const rows = async (sql: string, params: unknown[] = []) => {
    const [r] = await conn.query<RowDataPacket[]>(sql, params);
    return r as Row[];
  };
  const table = (name: string) => ident(`${prefix}${name}`);
  const text = (v: unknown) => (Buffer.isBuffer(v) ? v.toString("latin1") : String(v));
  return {
    prefix,
    async tables() {
      return (await rows("SHOW TABLES")).map((r) => text(Object.values(r)[0]));
    },
    async columns(name) {
      return (await rows(`SHOW COLUMNS FROM ${table(name)}`)).map((r) => text(r.Field));
    },
    all: (name, orderBy) =>
      rows(`SELECT * FROM ${table(name)}${orderBy ? ` ORDER BY ${ident(orderBy)}` : ""}`),
    batch: (name, key, after, limit, where) =>
      rows(
        `SELECT * FROM ${table(name)} WHERE ${ident(key)} > ?${where ? ` AND (${where})` : ""} ORDER BY ${ident(key)} LIMIT ?`,
        [after, limit],
      ),
    query: (sql, params) => rows(sql.replaceAll("{p}", prefix), params),
    close: () => conn.end(),
  };
}
