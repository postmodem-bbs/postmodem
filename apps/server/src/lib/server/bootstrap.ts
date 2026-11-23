// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds the application context. Framework-free: used by the CLI (production) and by
// SvelteKit hooks (dev server), so both start the board the same way.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type Ban,
  boardName,
  type CapabilityRegistry,
  type Config,
  coreRegistry,
  coreSettings,
  createLogger,
  type Id,
  installCorePermissions,
  LOGIN_IP_POLICY,
  LOGIN_POLICY,
  type LoadedConfig,
  type Logger,
  loadConfig,
  loadSnapshot,
  MAIL_IP_POLICY,
  MAIL_POLICY,
  MEMBER_MAIL_POLICY,
  type Permissions,
  POSTING_POLICY,
  permissionsFor,
  postsPerHour,
  REGISTER_POLICY,
  SEARCH_POLICY,
  Settings,
  searchesPerMinute,
  Throttle,
  viewerFor,
} from "@postmodem/core";
import { type Database, openDatabase } from "@postmodem/db";
import { createRenderer, type Renderer } from "./content.ts";
import { Worker } from "./jobs.ts";
import { createMailer, defaultSender, type Mailer, type MailMessage } from "./mail.ts";
import { Meilisearch } from "./meilisearch.ts";
import {
  createPackageHost,
  INSTALLED_PACKAGES,
  type PackageHost,
  packageMigrations,
  packagePermissions,
} from "./packages.ts";
import { createPlatform, type Platform } from "./platform.ts";
import { rebuildSearch, searchPlan } from "./search.ts";

export interface AppContext {
  config: Config;
  loaded: LoadedConfig;
  db: Database;
  settings: Settings;
  renderer: Renderer;
  capabilities: CapabilityRegistry;
  /** Progressive delays, shared by every replica through the database (core throttle.ts). */
  throttles: {
    login: Throttle;
    loginIp: Throttle;
    register: Throttle;
    mail: Throttle;
    mailIp: Throttle;
    memberMail: Throttle;
    search: Pick<Throttle, "wait" | "fail" | "reset">;
    posting: Pick<Throttle, "wait" | "fail" | "reset">;
  };
  mailer: Mailer;
  externalSearch: Meilisearch | null;
  /** Queues an e-mail; the worker sends it (with retries), never the web request. */
  sendMail(message: MailMessage): Promise<void>;
  /** This process's job worker; started only by roles that run one (run, worker, dev). */
  worker: Worker;
  /** Active bans, cached for a few seconds (every replica sees a new ban within BAN_REFRESH_MS). */
  activeBans(): Promise<Ban[]>;
  /** Drop the cache after this process changed the bans. */
  invalidateBans(): void;
  /** Installed packages and which are enabled (M2 slice 3). */
  packages: PackageHost;
  /**
   * Platform services (M2b slice 10): preferences, fields, collections, live channels and
   * counters (topic views among them; started by roles that serve pages, flushed at shutdown).
   */
  platform: Platform;
  /** Permission view for one request (null = guest). Loads a fresh snapshot each call. */
  permissions(userId: Id | null): Promise<Permissions>;
  /**
   * Re-reads settings every few seconds, so a change made by the CLI or another replica takes
   * effect without a restart. Returns a function that stops it.
   */
  watchSettings(intervalMs?: number): () => void;
  log: Logger;
  startedAt: Date;
  readiness(): Promise<{ ready: boolean; reason?: string }>;
}

/** How quickly a setting changed elsewhere (CLI, another replica) reaches this process. */
export const SETTINGS_REFRESH_MS = 5_000;

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

export async function createContext(opts: {
  migrate: boolean;
  loaded?: LoadedConfig;
  /**
   * Roles that serve pages (run, web, dev): live updates and counters use the configured
   * transports. Other roles and one-off commands keep them in memory, so they open no
   * listening connections and exit when done.
   */
  live?: boolean;
}): Promise<AppContext> {
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
    const pkg = await db.migratePackages(packageMigrations(INSTALLED_PACKAGES, db.dialect));
    if (pkg.length) log.info("applied package migrations", { migrations: pkg });
  }
  const registry = coreSettings();
  for (const p of INSTALLED_PACKAGES) registry.register(...(p.settings ?? []));
  const settings = new Settings(registry, db.settingsStore());
  const pkgPerms = packagePermissions(INSTALLED_PACKAGES);
  // Settings can only load once the schema exists; in stack mode `migrate` may still be running.
  let settingsLoaded = false;
  const tryLoadSettings = async () => {
    if (settingsLoaded || (await db.pendingMigrations()).length) return;
    for (const p of await settings.init()) log.warn(p);
    const { defaultGrants } = await installCorePermissions(db.repos, pkgPerms);
    if (defaultGrants)
      log.info("granted phpBB2's default permissions: everyone reads, registered users post");
    settingsLoaded = true;
  };
  await tryLoadSettings();
  const capabilities = coreRegistry(pkgPerms.capabilities);
  const platform = createPlatform({
    config: opts.live ? config : {},
    db,
    installed: INSTALLED_PACKAGES,
    log,
  });
  const packages = await createPackageHost({
    platform,
    installed: INSTALLED_PACKAGES,
    repos: db.repos,
    db: db.kysely.withoutPlugins(),
    settings,
    profile: config.profile,
    log,
  });
  const mailer = createMailer(config, log, () => defaultSender(config, settings.get(boardName)));
  if (mailer.kind === "log")
    log.warn("e-mail goes to the log (POSTMODEM_MAIL_URL=log://); set an smtp:// URL to deliver it");
  const worker = new Worker(
    db.repos,
    {
      "mail.send": (payload) => mailer.send(payload as MailMessage),
      "search.rebuild": async (payload) => {
        await settings.reload();
        const plan = searchPlan(packages.searchContributions());
        if ((payload as { version: string }).version !== plan.version) return;
        const posts = await rebuildSearch(db.repos, undefined, plan, false);
        log.info("rebuilt package search index", { posts });
      },
    },
    log,
  );

  return {
    config,
    loaded,
    db,
    settings,
    renderer: createRenderer(db.repos, packages.renderTags),
    capabilities,
    throttles: {
      login: new Throttle(LOGIN_POLICY, db.repos.throttle, "login"),
      loginIp: new Throttle(LOGIN_IP_POLICY, db.repos.throttle, "login-ip"),
      register: new Throttle(
        { ...REGISTER_POLICY, free: config.registrationsPerIpHour || Number.POSITIVE_INFINITY },
        db.repos.throttle,
        "register-ip",
      ),
      mail: new Throttle(MAIL_POLICY, db.repos.throttle, "mail"),
      get search() {
        const free = settings.get(searchesPerMinute);
        return free === 0
          ? { wait: async () => 0, fail: async () => {}, reset: async () => {} }
          : new Throttle({ ...SEARCH_POLICY, free }, db.repos.throttle, "search-ip");
      },
      // The posting limit is a board setting (core.posting.perHour, 0 = off), read per call.
      get posting() {
        const free = settings.get(postsPerHour);
        return free === 0
          ? { wait: async () => 0, fail: async () => {}, reset: async () => {} }
          : new Throttle({ ...POSTING_POLICY, free }, db.repos.throttle, "posting");
      },
      mailIp: new Throttle(MAIL_IP_POLICY, db.repos.throttle, "mail-ip"),
      memberMail: new Throttle(MEMBER_MAIL_POLICY, db.repos.throttle, "member-mail"),
    },
    mailer,
    externalSearch: config.searchUrl === "builtin://" ? null : new Meilisearch(config, db, log),
    worker,
    ...banCache(db),
    packages,
    platform,
    async sendMail(message) {
      await db.repos.jobs.enqueue("mail.send", message);
      worker.nudge();
    },
    async permissions(userId) {
      const [snapshot, viewer] = await Promise.all([loadSnapshot(db.repos), viewerFor(db.repos, userId)]);
      return permissionsFor(capabilities, snapshot, viewer);
    },
    watchSettings(intervalMs = SETTINGS_REFRESH_MS) {
      const refresh = async () => {
        if (!settingsLoaded) return;
        try {
          for (const p of await settings.reload()) log.warn(p);
          const { version } = searchPlan(packages.searchContributions());
          if (await db.repos.search.scheduleRebuild(version)) worker.nudge();
        } catch (e) {
          log.warn("could not refresh settings and search schema", { error: (e as Error).message });
        }
      };
      void refresh();
      const timer = setInterval(refresh, intervalMs);
      timer.unref();
      return () => clearInterval(timer);
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

export const BAN_REFRESH_MS = 15_000;

function banCache(db: Database) {
  let cached: { at: number; bans: Promise<Ban[]> } | undefined;
  return {
    activeBans() {
      const now = Date.now();
      if (!cached || now - cached.at > BAN_REFRESH_MS) {
        const bans = db.repos.bans.active(now);
        // A failed read isn't cached: the next request tries again.
        bans.catch(() => (cached = undefined));
        cached = { at: now, bans };
      }
      return cached.bans;
    },
    invalidateBans() {
      cached = undefined;
    },
  };
}

declare global {
  // Shared between the CLI and the SvelteKit bundle (each bundles its own module copy).
  var __postmodem: Promise<AppContext> | undefined;
}

/**
 * The context the CLI installed, or (dev server) a new one that migrates on start and runs
 * the job worker in-process, like solo mode.
 */
export function getContext(): Promise<AppContext> {
  globalThis.__postmodem ??= createContext({ migrate: true, live: true }).then((ctx) => {
    ctx.worker.start();
    ctx.externalSearch?.start();
    ctx.watchSettings();
    ctx.platform.counters.start();
    return ctx;
  });
  return globalThis.__postmodem;
}
