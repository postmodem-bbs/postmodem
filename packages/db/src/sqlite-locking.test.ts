// SPDX-License-Identifier: AGPL-3.0-or-later
// Two processes on one SQLite file (the CLI next to a running solo board). Transactions take
// the write lock when they begin, so another writer waits instead of making our write fail
// with "database is locked" (CI's load-test step hit exactly that).
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createDatabase } from "./database.ts";
import { sqliteEngine } from "./engines.ts";

it("a transaction survives another process writing while it runs", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "pm-lock-")), "board.sqlite");
  const db = createDatabase(sqliteEngine(file));
  await db.migrate();
  const otherWrite = () => {
    // A separate process, as `postmodem …` next to a server would be; it gives up after 300 ms.
    try {
      execFileSync(process.execPath, [
        "-e",
        `const { DatabaseSync } = require("node:sqlite");
         const d = new DatabaseSync(${JSON.stringify(file)});
         d.exec("PRAGMA busy_timeout = 300");
         d.exec("insert into settings (key, value, updated_at) values ('x.other', '1', '')");`,
      ]);
      return "wrote";
    } catch {
      return "waited";
    }
  };
  let other = "";
  await db.repos.transaction(async (r) => {
    await r.nodes.tree(); // a read first: with a plain BEGIN this is only a read lock
    other = otherWrite();
    await r.nodes.create({ parentId: null, kind: "forum", title: "Mine" });
  });
  // Our write went through; the other process had to wait for our lock (and gave up).
  expect(other).toBe("waited");
  expect((await db.repos.nodes.tree()).map((n) => n.title)).toEqual(["Mine"]);
  await db.close();
});
