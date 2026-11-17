// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds the application context. Framework-free: used by the CLI (production) and by
// SvelteKit hooks (dev server), so both start the board the same way.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
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
  type Permissions,
  permissionsFor,
  REGISTER_POLICY,
  Settings,
  Throttle,
  viewerFor,
} from "@postmodem/core";
import { type Database, openDatabase } from "@postmodem/db";
import { createRenderer, type Renderer } from "./content.ts";
import { Worker } from "./jobs.ts";
import { createMailer, defaultSender, type Mailer, type MailMessage } from "./mail.ts";

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
  };
  mailer: Mailer;
  /** Queues an e-mail; the worker sends it (with retries), never the web request. */
  sendMail(message: MailMessage): Promise<void>;
  /** This process's job worker; started only by roles that run one (run, worker, dev). */
  worker: Worker;
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
  const mailer = createMailer(config, log, () => defaultSender(config, settings.get(boardName)));
  if (mailer.kind === "log")
    log.warn("e-mail goes to the log (POSTMODEM_MAIL_URL=log://); set an smtp:// URL to deliver it");
  const worker = new Worker(db.repos, { "mail.send": (payload) => mailer.send(payload as MailMessage) }, log);

  return {
    config,
    loaded,
    db,
    settings,
    renderer: createRenderer(db.repos),
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
      mailIp: new Throttle(MAIL_IP_POLICY, db.repos.throttle, "mail-ip"),
    },
    mailer,
    worker,
    async sendMail(message) {
      await db.repos.jobs.enqueue("mail.send", message);
      worker.nudge();
    },
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

/**
 * The context the CLI installed, or (dev server) a new one that migrates on start and runs
 * the job worker in-process, like solo mode.
 */
export function getContext(): Promise<AppContext> {
  globalThis.__postmodem ??= createContext({ migrate: true }).then((ctx) => {
    ctx.worker.start();
    return ctx;
  });
  return globalThis.__postmodem;
}
