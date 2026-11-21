// SPDX-License-Identifier: AGPL-3.0-or-later
// The schema-scoped Postgres introspector (#115): same answers as Kysely's for the board's own
// schema, nothing from other schemas, and migrations that survive other schemas being dropped.
import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "./database.ts";
import { postgresEngine } from "./engines.ts";
import { SchemaScopedPostgresIntrospector } from "./pg-introspector.ts";

describe("schema-scoped introspector", () => {
  let db: Kysely<unknown>;
  afterEach(async () => {
    await db.destroy();
  });

  it("matches Kysely's own introspector for the current schema, and sees no other", async () => {
    db = new Kysely<unknown>({ dialect: new PGliteDialect(new PGlite()) });
    await sql`create table posts (id bigserial primary key, body text not null default '', note int)`.execute(
      db,
    );
    await sql`comment on column posts.note is 'a note'`.execute(db);
    await sql`create view recent as select id from posts`.execute(db);
    await sql`create table kysely_migration (name text)`.execute(db);
    await sql`create schema other`.execute(db);
    await sql`create table other.elsewhere (id serial primary key)`.execute(db);

    const scoped = new SchemaScopedPostgresIntrospector(db);
    for (const withInternalKyselyTables of [false, true]) {
      const stock = (await db.introspection.getTables({ withInternalKyselyTables })).filter(
        (t) => t.schema === "public",
      );
      expect(await scoped.getTables({ withInternalKyselyTables })).toEqual(stock);
    }
    const names = (await scoped.getTables({ withInternalKyselyTables: true })).map((t) => t.name);
    expect(names).toEqual(["kysely_migration", "posts", "recent"]);
    expect((await scoped.getSchemas()).map((s) => s.name)).toEqual(
      expect.arrayContaining(["public", "other"]),
    );
  });
});

const url = process.env.PM_TEST_PG_URL;

describe.skipIf(!url)("migrations on a shared Postgres server", () => {
  it("survive other schemas being created and dropped while they run", async () => {
    const churn = postgres(url!, { max: 2, onnotice: () => {} });
    const admin = postgres(url!, { max: 1, onnotice: () => {} });
    const schema = `t_scoped_${process.pid}`;
    await admin.unsafe(`drop schema if exists ${schema} cascade; create schema ${schema}`);
    let stop = false;
    const churner = (async () => {
      for (let i = 0; !stop; i++) {
        const s = `t_churn_${process.pid}_${i}`;
        await churn.unsafe(`create schema ${s}; create table ${s}.t (id bigserial primary key, a int)`);
        await churn.unsafe(`drop schema ${s} cascade`);
      }
    })();
    const database = createDatabase(postgresEngine(`${url}?search_path=${schema}`));
    try {
      // Every migrate() asks the introspector whether the bookkeeping tables exist. With
      // Kysely's stock introspector about one call in thirty failed while schemas churned.
      for (let i = 0; i < 40; i++) await database.migrate();
    } finally {
      stop = true;
      await churner;
      await database.close();
      await admin.unsafe(`drop schema ${schema} cascade`);
      await Promise.all([churn.end(), admin.end()]);
    }
  }, 60_000);
});
