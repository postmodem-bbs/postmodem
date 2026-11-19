// SPDX-License-Identifier: AGPL-3.0-or-later
// `postmodem backup` and `restore` (M2 slice 9). A backup is a directory:
//   postmodem.sqlite   a consistent copy taken while the board runs (VACUUM INTO)
//   uploads/           smilies, avatars and other files
//   manifest.json      version, time and the migrations it contains
// Restoring replaces the database and uploads, keeping the current ones as *.before-restore;
// it needs the board stopped. Postgres boards back up with pg_dump (docs/CONTAINERS.md).
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppContext } from "./bootstrap.ts";
import { uploadsDir } from "./uploads.ts";

export interface BackupManifest {
  format: 1;
  version: string;
  revision: string;
  createdAt: string;
  dialect: "sqlite";
}

const exists = async (p: string) => !!(await stat(p).catch(() => null));

export function sqlitePath(databaseUrl: string): string | null {
  return databaseUrl.startsWith("sqlite://") ? databaseUrl.slice("sqlite://".length) : null;
}

export async function backup(ctx: AppContext, dir?: string): Promise<string> {
  if (ctx.db.dialect !== "sqlite")
    throw new Error("this board runs on Postgres: back it up with pg_dump (docs/CONTAINERS.md §4.5)");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = dir ?? join(ctx.config.dataDir, "backups", stamp);
  if (await exists(join(target, "manifest.json"))) throw new Error(`${target} already holds a backup`);
  await mkdir(target, { recursive: true });
  await ctx.db.backupTo(join(target, "postmodem.sqlite"));
  const uploads = uploadsDir(ctx.config.dataDir);
  if (await exists(uploads)) await cp(uploads, join(target, "uploads"), { recursive: true });
  const manifest: BackupManifest = {
    format: 1,
    version: ctx.config.version,
    revision: ctx.config.revision,
    createdAt: new Date().toISOString(),
    dialect: "sqlite",
  };
  await writeFile(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return target;
}

/** Puts a backup in place of the board's database and uploads. The board must be stopped. */
export async function restore(dataDir: string, databaseUrl: string, from: string): Promise<BackupManifest> {
  const db = sqlitePath(databaseUrl);
  if (!db)
    throw new Error("restore is for SQLite boards; on Postgres use pg_restore (docs/CONTAINERS.md §4.5)");
  const manifest = JSON.parse(await readFile(join(from, "manifest.json"), "utf8")) as BackupManifest;
  if (manifest.format !== 1 || manifest.dialect !== "sqlite")
    throw new Error(`${from} isn't a Postmodem backup this version can restore`);
  if (!(await exists(join(from, "postmodem.sqlite")))) throw new Error(`${from} has no postmodem.sqlite`);
  const keep = async (p: string) => {
    if (!(await exists(p))) return;
    await rm(`${p}.before-restore`, { recursive: true, force: true });
    await rename(p, `${p}.before-restore`);
  };
  await keep(db);
  for (const side of ["-wal", "-shm"]) await rm(`${db}${side}`, { force: true });
  await cp(join(from, "postmodem.sqlite"), db);
  const uploads = uploadsDir(dataDir);
  await keep(uploads);
  if (await exists(join(from, "uploads"))) await cp(join(from, "uploads"), uploads, { recursive: true });
  return manifest;
}
