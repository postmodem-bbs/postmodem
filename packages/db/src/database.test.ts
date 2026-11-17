// SPDX-License-Identifier: AGPL-3.0-or-later
// The same behavioural tests run against SQLite (node:sqlite) and Postgres (PGlite).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { boardName, coreSettings, Settings } from "@postmodem/core";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "./database.ts";
import { MIGRATIONS, openDatabase, pgDatabase } from "./index.ts";

function pgliteDatabase(): Database {
  const client = new PGlite();
  let queue = Promise.resolve();
  return pgDatabase({
    orm: drizzle(client),
    // PGlite is a single connection: serialise sessions to mimic a reserved connection.
    withSession: (fn) => {
      const run = queue.then(() =>
        fn({
          exec: async (sql) => void (await client.exec(sql)),
          query: async <T>(sql: string, params: unknown[] = []) => (await client.query<T>(sql, params)).rows,
        }),
      );
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    close: () => client.close(),
  });
}

const tmp = mkdtempSync(join(tmpdir(), "pm-db-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const backends: [string, () => Database][] = [
  ["sqlite", () => openDatabase(`sqlite://${join(tmp, `t-${Math.random()}.sqlite`)}`)],
  ["postgres (pglite)", pgliteDatabase],
];

describe.each(backends)("%s", (_name, open) => {
  it("reports and applies pending migrations exactly once", async () => {
    const db = open();
    expect(await db.pendingMigrations()).toEqual(MIGRATIONS.map((m) => m.id));
    expect(await db.migrate()).toEqual(MIGRATIONS.map((m) => m.id));
    expect(await db.pendingMigrations()).toEqual([]);
    expect(await db.migrate()).toEqual([]);
    await db.close();
  });

  it("serialises concurrent migration runs", async () => {
    const db = open();
    const [a, b] = await Promise.all([db.migrate(), db.migrate()]);
    expect([...a, ...b].sort()).toEqual(MIGRATIONS.map((m) => m.id));
    await db.close();
  });

  it("persists settings through the core Settings service", async () => {
    const db = open();
    await db.migrate();
    const s1 = new Settings(coreSettings(), db.settingsStore());
    await s1.init();
    await s1.set(boardName, "Retro Corner");
    await s1.set(boardName, "Retro Corner 2");
    const s2 = new Settings(coreSettings(), db.settingsStore());
    await s2.init();
    expect(s2.get(boardName)).toBe("Retro Corner 2");
    await db.ping();
    await db.close();
  });
});

it("creates the SQLite directory and rejects unknown URL schemes", async () => {
  const db = openDatabase(`sqlite://${join(tmp, "nested", "dir", "pm.sqlite")}`);
  await db.migrate();
  await db.close();
  expect(() => openDatabase("mysql://x")).toThrow(/unsupported database URL/);
});
