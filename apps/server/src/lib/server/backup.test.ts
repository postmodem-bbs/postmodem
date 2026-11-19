// SPDX-License-Identifier: AGPL-3.0-or-later
// Backup and restore round trip on SQLite (M2 slice 9).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { backup, restore } from "./backup.ts";
import { createContext } from "./bootstrap.ts";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

it("backs up a running board and restores it, keeping what it replaced", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "pm-backup-"));
  process.env.POSTMODEM_DATA_DIR = dataDir;
  process.env.POSTMODEM_LOG_LEVEL = "error";
  let ctx = await createContext({ migrate: true });
  await ctx.db.repos.nodes.create({ parentId: null, kind: "forum", title: "Before" });
  mkdirSync(join(dataDir, "uploads", "smilies"), { recursive: true });
  writeFileSync(join(dataDir, "uploads", "smilies", "a.gif"), "GIF");
  const dir = await backup(ctx);
  expect(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))).toMatchObject({
    format: 1,
    dialect: "sqlite",
  });
  await expect(backup(ctx, dir)).rejects.toThrow(/already holds/);

  await ctx.db.repos.nodes.create({ parentId: null, kind: "forum", title: "After" });
  writeFileSync(join(dataDir, "uploads", "smilies", "b.gif"), "GIF");
  await ctx.db.close();

  await restore(dataDir, ctx.config.databaseUrl, dir);
  ctx = await createContext({ migrate: true });
  expect((await ctx.db.repos.nodes.tree()).map((n) => n.title)).toEqual(["Before"]);
  expect(existsSync(join(dataDir, "uploads", "smilies", "a.gif"))).toBe(true);
  expect(existsSync(join(dataDir, "uploads", "smilies", "b.gif"))).toBe(false);
  expect(existsSync(join(dataDir, "uploads.before-restore", "smilies", "b.gif"))).toBe(true);
  await ctx.db.close();
  await expect(restore(dataDir, "postgres://x/y", dir)).rejects.toThrow(/pg_restore/);
});
