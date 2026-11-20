// SPDX-License-Identifier: AGPL-3.0-or-later
// `postmodem backup` and `restore` (M2 slice 9). A backup is a directory:
//   postmodem.sqlite or postmodem.dump   a consistent database snapshot
//   uploads/           smilies, avatars and other files
//   manifest.json      version, time and database dialect
// Restoring replaces the database and uploads, keeping the current ones as *.before-restore;
// it needs the board stopped. Postgres archives are restored with pg_restore.
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { AppContext } from "./bootstrap.ts";
import { uploadsDir } from "./uploads.ts";

export interface BackupManifest {
  format: 1;
  version: string;
  revision: string;
  createdAt: string;
  dialect: "sqlite" | "pg";
}

const exists = async (p: string) => !!(await stat(p).catch(() => null));

export function sqlitePath(databaseUrl: string): string | null {
  return databaseUrl.startsWith("sqlite://") ? databaseUrl.slice("sqlite://".length) : null;
}

const run = promisify(execFile);
const bundledClient = "/opt/postmodem/pg";

async function dumpPostgres(ctx: AppContext, file: string): Promise<void> {
  // libpq also accepts multi-host URLs, which WHATWG URL rejects when hosts include ports.
  const credential = /^(postgres(?:ql)?:\/\/[^:/?@]*):([^/?]*)@/;
  const [database = ctx.config.databaseUrl, query] = ctx.config.databaseUrl.split(/\?(.*)/s);
  const inlinePassword = credential.exec(database)?.[2];
  const parameters = query?.split("&").filter((param) => !new URLSearchParams(param).has("password"));
  const url = database.replace(credential, "$1@") + (parameters?.length ? `?${parameters.join("&")}` : "");
  const password = ctx.config.databasePassword || (inlinePassword && decodeURIComponent(inlinePassword));
  const bundled = await exists(join(bundledClient, "loader"));
  const args = ["--format=custom", "--no-password", "--file", file, "--dbname", url];
  try {
    await run(
      bundled ? join(bundledClient, "loader") : "pg_dump",
      bundled ? ["--library-path", bundledClient, join(bundledClient, "pg_dump"), ...args] : args,
      {
        env: {
          ...process.env,
          PGHOST: process.env.PGHOST || "localhost",
          PGUSER: process.env.PGUSERNAME || process.env.PGUSER,
          ...(password ? { PGPASSWORD: password } : {}),
        },
      },
    );
  } catch (error) {
    const { code, stderr } = error as { code?: string | number; stderr?: string };
    if (code === "ENOENT") throw new Error("pg_dump is required to back up PostgreSQL");
    throw new Error(stderr?.trim() || `pg_dump failed (${code ?? "unknown error"})`);
  }
}

export async function backup(ctx: AppContext, dir?: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = dir ?? join(ctx.config.dataDir, "backups", stamp);
  if (await exists(join(target, "manifest.json"))) throw new Error(`${target} already holds a backup`);
  if ((await exists(target)) && (await readdir(target)).length)
    throw new Error(`${target} must be empty to receive a backup`);
  const destination = resolve(target);
  await mkdir(dirname(destination), { recursive: true });
  const staging = await mkdtemp(join(dirname(destination), ".postmodem-backup-"));
  try {
    if (ctx.db.dialect === "sqlite") await ctx.db.backupTo(join(staging, "postmodem.sqlite"));
    else await dumpPostgres(ctx, join(staging, "postmodem.dump"));
    const uploads = uploadsDir(ctx.config.dataDir);
    if (await exists(uploads)) await cp(uploads, join(staging, "uploads"), { recursive: true });
    const manifest: BackupManifest = {
      format: 1,
      version: ctx.config.version,
      revision: ctx.config.revision,
      createdAt: new Date().toISOString(),
      dialect: ctx.db.dialect,
    };
    await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(staging, destination);
    return target;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Puts a backup in place of the board's database and uploads. The board must be stopped. */
export async function restore(dataDir: string, databaseUrl: string, from: string): Promise<BackupManifest> {
  const db = sqlitePath(databaseUrl);
  if (!db)
    throw new Error(
      "restore is for SQLite boards; restore postmodem.dump into an empty Postgres database with pg_restore (docs/CONTAINERS.md §4.5)",
    );
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
