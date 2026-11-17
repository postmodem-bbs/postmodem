// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds the application context. Framework-free: used by the CLI (production) and by
// SvelteKit hooks (dev server), so both start the board the same way.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type CapabilityRegistry,
  type Config,
  coreRegistry,
  coreSettings,
  createLogger,
  type Id,
  installCorePermissions,
  type LoadedConfig,
  type Logger,
  loadConfig,
  loadSnapshot,
  type Permissions,
  permissionsFor,
  Settings,
  viewerFor,
} from "@postmodem/core";
import { type Database, openDatabase } from "@postmodem/db";
import { createRenderer, type Renderer } from "./content.ts";

export interface AppContext {
  config: Config;
  loaded: LoadedConfig;
  db: Database;
  settings: Settings;
  renderer: Renderer;
  capabilities: CapabilityRegistry;
  /** Permission view for one request (null = guest). Loads a fresh snapshot each call. */
  permissions(userId: Id | null): Promise<Permissions>;
  log: Logger;
  startedAt: Date;
  readiness(): Promise<{ ready: boolean; reason?: string }>;
}

export function readConfig(env: Record<string, string | undefined> = process.env): LoadedConfig {
  return loadConfig({
    env,
    readFile: (p) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return undefined;
      }
    },
  });
}

/** Use the configured secret, or generate one into <dataDir>/secrets on first boot. */
function ensureSecretKey(config: Config, log: Logger): string {
  if (config.secretKey) return config.secretKey;
  const file = join(config.dataDir, "secrets", "secret_key");
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, randomBytes(48).toString("base64url"), { mode: 0o600 });
    log.info("generated a new secret key", { file });
  }
  return readFileSync(file, "utf8").trim();
}

export async function createContext(opts: { migrate: boolean; loaded?: LoadedConfig }): Promise<AppContext> {
  const loaded = opts.loaded ?? readConfig();
  const { config } = loaded;
  const log = createLogger({
    level: config.logLevel,
    pretty: process.env.NODE_ENV === "development",
    base: { service: "postmodem" },
  });
  for (const w of loaded.warnings) log.warn(w);

  mkdirSync(config.dataDir, { recursive: true });
  config.secretKey = ensureSecretKey(config, log);

  const db = openDatabase(config.databaseUrl, { password: config.databasePassword });
  if (opts.migrate) {
    const ran = await db.migrate();
    if (ran.length) log.info("applied migrations", { migrations: ran });
  }
  const settings = new Settings(coreSettings(), db.settingsStore());
  // Settings can only load once the schema exists; in stack mode `migrate` may still be running.
  let settingsLoaded = false;
  const tryLoadSettings = async () => {
    if (settingsLoaded || (await db.pendingMigrations()).length) return;
    for (const p of await settings.init()) log.warn(p);
    const { defaultGrants } = await installCorePermissions(db.repos);
    if (defaultGrants)
      log.info("granted phpBB2's default permissions: everyone reads, registered users post");
    settingsLoaded = true;
  };
  await tryLoadSettings();
  const capabilities = coreRegistry();

  return {
    config,
    loaded,
    db,
    settings,
    renderer: createRenderer(db.repos),
    capabilities,
    async permissions(userId) {
      const [snapshot, viewer] = await Promise.all([loadSnapshot(db.repos), viewerFor(db.repos, userId)]);
      return permissionsFor(capabilities, snapshot, viewer);
    },
    log,
    startedAt: new Date(),
    async readiness() {
      try {
        await db.ping();
        const pending = await db.pendingMigrations();
        if (pending.length) return { ready: false, reason: `pending migrations: ${pending.join(", ")}` };
        await tryLoadSettings();
        return { ready: true };
      } catch (e) {
        return { ready: false, reason: `database unavailable: ${(e as Error).message}` };
      }
    },
  };
}

declare global {
  // Shared between the CLI and the SvelteKit bundle (each bundles its own module copy).
  var __postmodem: Promise<AppContext> | undefined;
}

/** The context the CLI installed, or (dev server) a new one that migrates on start. */
export function getContext(): Promise<AppContext> {
  globalThis.__postmodem ??= createContext({ migrate: true });
  return globalThis.__postmodem;
}
