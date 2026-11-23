#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// The `postmodem` CLI: one image, many roles (CONTAINERS.md §2.2).
import { accessSync, constants, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type RequestListener, type Server } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  avatarMaxBytes,
  avatarMaxHeight,
  avatarMaxWidth,
  avatarsGallery,
  avatarsRemote,
  avatarsUpload,
  boardDescription,
  boardName,
  ConfigError,
  cleanUsername,
  defaultLocale,
  demoBoard,
  describeConfig,
  emailProblem,
  hashPassword,
  installCorePermissions,
  PASSWORD_MIN,
  passwordProblem,
  usernameProblem,
} from "@postmodem/core";
import { anonymise, importPrzemo, type LegacySource, openMysqlSource, summarise } from "@postmodem/importer";
import { IP_LOG_RETENTION_DAYS, ipLogStore, loginSecuritySettings } from "@postmodem/modules";
import { backup, restore } from "../lib/server/backup.ts";
import { type AppContext, createContext, readConfig } from "../lib/server/bootstrap.ts";
import { DEMO_PASSWORD, seedDemo, seedLongTopic } from "../lib/server/demo.ts";
import { demoAccountsTable, demoFiles, isDemoBoard, setupDemo } from "../lib/server/demo-setup.ts";
import { sendDigests } from "../lib/server/notifications.ts";
import { INSTALLED_PACKAGES, packageMigrations, packagePermissions } from "../lib/server/packages.ts";
import { seedDefaultRanks } from "../lib/server/ranks.ts";
import { rebuildSearch, searchPlan } from "../lib/server/search.ts";
import { copyLegacyFiles, uploadsDir } from "../lib/server/uploads.ts";
import {
  BAN_HELP,
  banCommand,
  expireLegacyPasswords,
  FORUM_HELP,
  forumCommand,
  GROUP_HELP,
  groupCommand,
  INVITE_HELP,
  inviteCommand,
  PACKAGES_HELP,
  packagesCommand,
  USER_EXPIRE_HELP,
} from "./admin.ts";
import { clientAddressResolver } from "./client-address.ts";

const HELP = `postmodem — a modern bulletin board

Usage: postmodem <command>

  run           web + worker + scheduler in one process (solo mode, default)
  web           HTTP server only
  worker        background job worker
  scheduler     periodic job scheduler (run exactly one)
  migrate       apply database migrations and exit
  doctor        check configuration, data directory and database
  init          create the first administrator from POSTMODEM_ADMIN_* (idempotent)
  demo [--reset]
                make this board the demo: on an empty board, the demo content; then
                every demo account's password (postmodem-demo, Admin included) and the
                demo settings, again on an existing demo board (forgotten passwords);
                refuses a board that isn't a demo. --reset (SQLite, board stopped)
                deletes the demo board and builds it again. POSTMODEM_DEMO=1 makes
                \`run\` and \`migrate\` set up an empty board this way
  seed-demo     fill an empty board with demo content (refuses if forums exist)
  seed-demo --long-topic <posts>
                add one topic with that many posts, in its own forum, to any board
                (for performance tests of deep topic pages)
  import przemo --source mysql://user:pass@host/db [--prefix phpbb_] [--charset latin2|cp1250|utf8]
                [--files <old board directory>] [--dry-run] [--report <file>] [--report-bundle <file>]
                experimental until the Beta phase (docs/guide/importing.md): import a phpBB2 /
                Przemo board into a fresh board (resumable); the source URL can also
                come from POSTMODEM_IMPORT_SOURCE(_FILE); --files copies
                smiley and avatar images from the old board's directory
  perms explain --user <name|guest> --capability <key> [--node <id>]
                show whether a user may do something, and which grants decided it
  user set-password <name> [--password-file <path>]
                set a password (prompted, read from stdin, or from a file); signs the
                user out everywhere and activates a pending account
${USER_EXPIRE_HELP}
${GROUP_HELP}
${FORUM_HELP}
${BAN_HELP}
${INVITE_HELP}
${PACKAGES_HELP}
  settings list | get <key> | set <key> <value>
                show or change board settings (values are JSON, or plain text for
                strings), e.g. settings set core.urls.style numbered; running servers
                pick changes up within a few seconds
  backup [<directory>]
                copy a running SQLite or Postgres board (database + uploads),
                by default into <data>/backups/<time>
  restore <directory>
                restore a SQLite backup (the board must be stopped); the current database
                and uploads are kept as *.before-restore
  search rebuild
                rebuild the search index from every post (imports do this themselves)
  healthcheck   exit 0 if the local web server answers /healthz
  config print  show the effective configuration (secrets redacted)
  version       print version information
`;

const SHUTDOWN_GRACE_MS = 25_000;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function settingsCommand(sub: "list" | "get" | "set", args: string[]): Promise<number> {
  const ctx = await createContext({ migrate: true });
  try {
    const { settings } = ctx;
    if (sub === "list") {
      for (const [key, value] of settings.entries()) console.log(`${key} = ${JSON.stringify(value)}`);
      return 0;
    }
    const [key, raw] = args;
    const def = key ? settings.definition(key) : undefined;
    if (!def) {
      console.error(
        key ? `unknown setting '${key}' (see: postmodem settings list)` : "usage: settings get <key>",
      );
      return 2;
    }
    if (sub === "get") {
      console.log(JSON.stringify(settings.get(def)));
      return 0;
    }
    if (raw === undefined) {
      console.error("usage: settings set <key> <value>");
      return 2;
    }
    let value: unknown = raw;
    try {
      value = JSON.parse(raw);
    } catch {
      // Not JSON: a plain string (`settings set core.board.name My board`).
      value = args.slice(1).join(" ");
    }
    try {
      const saved = await settings.set(def, value);
      console.log(`${key} = ${JSON.stringify(saved)}`);
      return 0;
    } catch (e) {
      console.error((e as Error).message);
      return 1;
    }
  } finally {
    await ctx.db.close();
  }
}

async function permsExplain(args: string[]): Promise<number> {
  const userArg = flag(args, "user") ?? "guest";
  const capability = flag(args, "capability");
  const nodeArg = flag(args, "node");
  const ctx = await createContext({ migrate: false });
  try {
    if (!capability || !ctx.capabilities.get(capability)) {
      console.error(
        `unknown or missing --capability; known: ${ctx.capabilities
          .all()
          .map((c) => c.key)
          .join(", ")}`,
      );
      return 2;
    }
    const user = userArg === "guest" ? null : await ctx.db.repos.users.byUsername(userArg);
    if (user === undefined) {
      console.error(`no user named '${userArg}'`);
      return 2;
    }
    const node = nodeArg ? await ctx.db.repos.nodes.get(Number(nodeArg)) : null;
    if (node === undefined) {
      console.error(`no forum or category with id ${nodeArg}`);
      return 2;
    }
    const perms = await ctx.permissions(user?.id ?? null);
    console.log(
      `viewer: ${user ? `${user.username} (user ${user.id}, groups: ${perms.viewer.groupIds.join(", ") || "none"})` : "guest"}`,
    );
    if (node) console.log(`node:   ${node.title} (${node.path})`);
    console.log(perms.explain(capability, node));
    return perms.can(capability, node) ? 0 : 1;
  } finally {
    await ctx.db.close();
  }
}

/** A password typed without echo on a terminal, or the first line of piped stdin. */
async function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let data = "";
    for await (const chunk of stdin) data += chunk;
    return data.split(/\r?\n/)[0] ?? "";
  }
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const done = (fn: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
      fn();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(value));
        if (ch === "\u0003") return done(() => reject(new Error("cancelled")));
        if (ch === "\u007f" || ch === "\b") value = [...value].slice(0, -1).join("");
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function setPassword(args: string[]): Promise<number> {
  const name = args.find((a) => !a.startsWith("--") && a !== flag(args, "password-file"));
  if (!name) {
    console.error("usage: postmodem user set-password <name> [--password-file <path>]");
    return 2;
  }
  const ctx = await createContext({ migrate: false });
  try {
    const { repos } = ctx.db;
    const user = await repos.users.byUsername(name);
    if (!user) {
      console.error(`no user named '${name}'`);
      return 2;
    }
    const file = flag(args, "password-file");
    let password: string;
    if (file) password = readFileSync(file, "utf8").replace(/\r?\n$/, "");
    else {
      password = await readSecret(`New password for ${user.username}: `);
      if (process.stdin.isTTY && (await readSecret("Again: ")) !== password) {
        console.error("the passwords don't match");
        return 2;
      }
    }
    const problem =
      passwordProblem(password, [user.username, user.email ?? ""]) ??
      ctx.packages.passwordPolicy(password, user);
    if (problem) {
      console.error(`password rejected: ${problem} (at least ${PASSWORD_MIN} characters)`);
      return 2;
    }
    const { scheme, hash } = await hashPassword(password);
    await repos.credentials.set(user.id, scheme, hash);
    const ended = await repos.sessions.removeForUser(user.id);
    if (user.status === "pending") await repos.users.update(user.id, { status: "active" });
    await repos.audit.append({
      actorId: null,
      action: "user.password-set-by-cli",
      targetType: "user",
      targetId: String(user.id),
      details: {},
    });
    ctx.log.info("password set", { userId: user.id, username: user.username, sessionsEnded: ended });
    return 0;
  } finally {
    await ctx.db.close();
  }
}

async function importBoard(args: string[]): Promise<number> {
  const env = process.env;
  const sourceUrl =
    flag(args, "source") ??
    (env.POSTMODEM_IMPORT_SOURCE_FILE
      ? readFileSync(env.POSTMODEM_IMPORT_SOURCE_FILE, "utf8").trim()
      : env.POSTMODEM_IMPORT_SOURCE);
  if (!sourceUrl?.startsWith("mysql://")) {
    console.error("import: --source mysql://user:password@host:3306/database is required");
    return 2;
  }
  const charset = flag(args, "charset");
  if (charset && !["latin2", "cp1250", "utf8"].includes(charset)) {
    console.error("import: --charset must be latin2, cp1250 or utf8 (default: detect per value)");
    return 2;
  }
  const dryRun = args.includes("--dry-run");
  const ctx = await createContext({ migrate: true });
  let source: LegacySource | undefined;
  ctx.log.warn("the importer is experimental until the Beta phase: try it on a copy and keep the old board", {
    guide: "docs/guide/importing.md",
  });
  try {
    source = await openMysqlSource(sourceUrl, flag(args, "prefix") ?? "phpbb_");
    ctx.log.info(dryRun ? "import dry run started" : "import started", { prefix: source.prefix });
    const now = Date.now();
    const report = await importPrzemo(ctx.db.repos, source, {
      ipLogging: ctx.packages.isEnabled("ip-logging")
        ? {
            now,
            earliest: now - IP_LOG_RETENTION_DAYS * 86_400_000,
            record: (tx, entry) => ipLogStore(tx.raw).add(entry),
          }
        : undefined,
      dryRun,
      charset: charset as "latin2" | "cp1250" | "utf8" | undefined,
      log: (msg, fields) => ctx.log.info(`import: ${msg}`, fields),
    });
    if (!dryRun) {
      await ctx.db.syncIdSequences();
      const s = report.settings;
      if (s.boardName) await ctx.settings.set(boardName, s.boardName.slice(0, 80));
      if (s.boardDescription !== undefined)
        await ctx.settings.set(boardDescription, s.boardDescription.slice(0, 300));
      if (s.defaultLocale) await ctx.settings.set(defaultLocale, s.defaultLocale);
      // phpBB2's avatar limits and sources (#131). Its remote avatars were shown from the other
      // site; here a link is downloaded once, so the same switch is the safer behaviour.
      const avatarKeys = {
        upload: avatarsUpload,
        remote: avatarsRemote,
        gallery: avatarsGallery,
        maxBytes: avatarMaxBytes,
        maxWidth: avatarMaxWidth,
        maxHeight: avatarMaxHeight,
      } as const;
      for (const [key, def] of Object.entries(avatarKeys)) {
        const value = s.avatars?.[key as keyof typeof avatarKeys];
        if (value !== undefined) await ctx.settings.set<number | boolean>(def, value);
      }
      if (s.loginSecurity) {
        for (const key of [
          "maxFailures",
          "blockMinutes",
          "minPasswordLength",
          "requireLettersAndNumbers",
        ] as const) {
          const value = s.loginSecurity[key];
          if (value !== undefined)
            await ctx.settings.set<number | boolean>(loginSecuritySettings[key], value);
        }
      }
      const indexed = await rebuildSearch(
        ctx.db.repos,
        (n) => n % 20_000 === 0 && ctx.log.info("search index", { posts: n }),
        searchPlan(ctx.packages.searchContributions()),
      );
      ctx.log.info("search index built", { posts: indexed });
      await ctx.db.repos.audit.append({
        actorId: null,
        action: "board.imported",
        targetType: "board",
        targetId: "przemo",
        details: { counts: report.counts },
      });
    }
    const reportFile =
      flag(args, "report") ??
      join(ctx.config.dataDir, `import-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    const bundle = flag(args, "report-bundle");
    if (bundle) writeFileSync(bundle, `${JSON.stringify(anonymise(report), null, 2)}\n`);
    console.log(summarise(report));
    const filesDir = flag(args, "files");
    if (filesDir && !dryRun) {
      const r = await copyLegacyFiles(filesDir, uploadsDir(ctx.config.dataDir), report.files);
      console.log(`\nFiles: ${r.copied} of ${report.files.length} images copied from ${filesDir}`);
      if (r.missing.length)
        console.log(
          `  missing (${r.missing.length}): ${r.missing.slice(0, 10).join(", ")}${r.missing.length > 10 ? ", …" : ""}`,
        );
      if (r.refused.length)
        console.log(
          `  refused, not plain image paths (${r.refused.length}): ${r.refused.slice(0, 10).join(", ")}`,
        );
    } else if (report.files.length)
      console.log(
        `\nFiles: ${report.files.length} smiley/avatar images are on the old server; run again with --files <old board directory> to copy them`,
      );
    console.log(
      `\nFull report: ${reportFile}${bundle ? `\nAnonymised bundle for bug reports: ${bundle}` : ""}`,
    );
    return 0;
  } catch (e) {
    ctx.log.error("import failed", { error: (e as Error).message });
    console.error(`import failed: ${(e as Error).message}\nRun the same command again to resume.`);
    return 1;
  } finally {
    await source?.close();
    await ctx.db.close();
  }
}

async function startWeb(ctx: AppContext): Promise<Server> {
  const { config } = ctx;
  // adapter-node reads these when the handler module loads.
  process.env.ORIGIN ??= config.publicUrl;
  const addressHeader = "x-postmodem-client-address";
  process.env.ADDRESS_HEADER = addressHeader;
  const resolveAddress = clientAddressResolver(config);
  globalThis.__postmodem = Promise.resolve(ctx);
  ctx.watchSettings();
  ctx.platform.counters.start();
  const handlerUrl = pathToFileURL(join(import.meta.dirname, "handler.js")).href;
  const { handler } = (await import(handlerUrl)) as { handler: RequestListener };
  const server = createServer((req, res) => {
    // Always overwrite the internal handoff to adapter-node, including on direct requests.
    const forwarded = req.headers["x-forwarded-for"];
    req.headers[addressHeader] = resolveAddress(
      req.socket.remoteAddress ?? "",
      Array.isArray(forwarded) ? forwarded.join(",") : forwarded,
    );
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  ctx.log.info("web server listening", { host: config.host, port: config.port, publicUrl: config.publicUrl });
  return server;
}

function startRole(ctx: AppContext, role: "worker" | "scheduler") {
  if (role === "worker") {
    ctx.worker.start();
    ctx.externalSearch?.start();
    return;
  }
  ctx.log.info("scheduler started");
  // Housekeeping only: expired rows are already refused on use.
  const purge = async () => {
    const now = Date.now();
    try {
      const sessions = await ctx.db.repos.sessions.purgeExpired(now);
      const jobs = await ctx.db.repos.jobs.purgeFinished(now - 7 * 24 * 3600_000);
      const throttle = await ctx.db.repos.throttle.purge(now - 24 * 3600_000);
      const documents = await ctx.platform.collections.applyRetention(now);
      const emailTokens = await ctx.db.repos.emailTokens.purgeExpired(now);
      const packages = await ctx.packages.housekeeping(now);
      if (sessions + jobs + throttle + documents + emailTokens + packages)
        ctx.log.info("housekeeping", { sessions, jobs, throttle, documents, emailTokens, packages });
    } catch (e) {
      ctx.log.warn("housekeeping failed", { error: (e as Error).message });
    }
  };
  setInterval(purge, 3600_000).unref();
  // Daily digests go out at each member's chosen hour; checking every ten minutes keeps them close to it.
  const digests = async () => {
    try {
      for (let sent = await sendDigests(ctx); sent > 0; sent = await sendDigests(ctx))
        ctx.log.info("digests queued", { emails: sent });
    } catch (e) {
      ctx.log.warn("digests failed", { error: (e as Error).message });
    }
  };
  void digests();
  setInterval(digests, 10 * 60_000).unref();
}

/**
 * First administrator, non-interactively (containers, CI): POSTMODEM_ADMIN_EMAIL plus
 * POSTMODEM_ADMIN_PASSWORD_FILE (preferred) or POSTMODEM_ADMIN_PASSWORD, and optionally
 * POSTMODEM_ADMIN_USERNAME (default "admin"; reserved names are allowed here). Does nothing
 * if the board already has an administrator.
 */
async function init(env: Record<string, string | undefined>): Promise<number> {
  const ctx = await createContext({ migrate: true });
  try {
    const { repos } = ctx.db;
    await installCorePermissions(repos, packagePermissions(INSTALLED_PACKAGES));
    const adminRole = await repos.roles.byKey("core:admin");
    const existing = (await repos.grants.all()).find(
      (g) => g.roleId === adminRole?.id && g.nodeId === null && g.subject.type === "user",
    );
    if (existing) {
      ctx.log.info("the board already has an administrator; nothing to do");
      return 0;
    }
    const username = cleanUsername(env.POSTMODEM_ADMIN_USERNAME ?? "admin");
    const email = (env.POSTMODEM_ADMIN_EMAIL ?? "").trim();
    const file = env.POSTMODEM_ADMIN_PASSWORD_FILE;
    const password = file
      ? readFileSync(file, "utf8").replace(/\r?\n$/, "")
      : (env.POSTMODEM_ADMIN_PASSWORD ?? "");
    const problems = [
      usernameProblem(username) && `POSTMODEM_ADMIN_USERNAME: ${usernameProblem(username)}`,
      emailProblem(email) && "POSTMODEM_ADMIN_EMAIL: missing or invalid",
      passwordProblem(password, [username, email]) &&
        `POSTMODEM_ADMIN_PASSWORD(_FILE): ${passwordProblem(password, [username, email])}`,
      ((await repos.users.lookalike(username)) || (await repos.users.byEmail(email))) &&
        "a user with that name or e-mail already exists; grant it core:admin instead",
    ].filter(Boolean);
    if (problems.length) {
      for (const p of problems) console.error(`init: ${p}`);
      return 2;
    }
    const { scheme, hash } = await hashPassword(password);
    const user = await repos.transaction(async (r) => {
      const u = await r.users.create({ username, email });
      await r.credentials.set(u.id, scheme, hash);
      await r.grants.create(adminRole!.id, { type: "user", id: u.id }, null);
      // A new board starts with phpBB2-style ranks; its first admin is the owner.
      const ranks = await seedDefaultRanks(r, ctx.settings.get(defaultLocale));
      const owner = ranks?.get("owner");
      if (owner) await r.users.update(u.id, { rankId: owner.id });
      await r.audit.append({
        actorId: null,
        action: "board.initialised",
        targetType: "user",
        targetId: String(u.id),
        details: {},
      });
      return u;
    });
    ctx.log.info("administrator created", { userId: user.id, username });
    return 0;
  } finally {
    await ctx.db.close();
  }
}

function onShutdown(ctx: AppContext, servers: Server[]) {
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    ctx.log.info("shutting down", { signal });
    const force = setTimeout(() => {
      ctx.log.warn("grace period over, closing remaining connections");
      for (const s of servers) s.closeAllConnections();
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    ctx.platform.endStreams(); // live streams would otherwise hold the server open
    await Promise.all([
      ...servers.map((s) => new Promise((r) => s.close(r))),
      ctx.worker.stop(),
      ctx.externalSearch?.stop(),
    ]);
    await ctx.platform.close();
    await ctx.db.close();
    ctx.log.info("bye");
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}

async function doctor(): Promise<number> {
  const results: [boolean, string][] = [];
  const check = async (label: string, fn: () => Promise<string | undefined> | string | undefined) => {
    try {
      const note = await fn();
      results.push([true, note ? `${label}: ${note}` : label]);
      return true;
    } catch (e) {
      results.push([false, `${label}: ${(e as Error).message}`]);
      return false;
    }
  };

  let loaded: ReturnType<typeof readConfig> | undefined;
  await check("configuration is valid", () => {
    loaded = readConfig();
    return loaded.warnings.length
      ? `${loaded.warnings.length} warning(s): ${loaded.warnings.join("; ")}`
      : undefined;
  });
  if (loaded) {
    const { config } = loaded;
    await check(`data directory ${config.dataDir} is writable`, () => {
      mkdirSync(config.dataDir, { recursive: true });
      accessSync(config.dataDir, constants.W_OK);
      const probe = join(config.dataDir, `.doctor-${process.pid}`);
      writeFileSync(probe, "ok");
      unlinkSync(probe);
      return undefined;
    });
    await check("public URL", () => {
      const u = new URL(config.publicUrl);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
      if (u.protocol !== "https:" && !local) throw new Error(`${config.publicUrl} is not HTTPS`);
      return config.publicUrl;
    });
    let ctx: AppContext | undefined;
    if (
      await check("database is reachable", async () => {
        ctx = await createContext({ migrate: false, loaded });
        await ctx.db.ping();
        return ctx.db.dialect;
      })
    ) {
      await check("migrations are up to date", async () => {
        const pending = await ctx!.db.pendingMigrations();
        if (pending.length) throw new Error(`pending: ${pending.join(", ")} (run \`postmodem migrate\`)`);
        return undefined;
      });
      await check("mail transport", async () => {
        await ctx!.mailer.verify();
        return ctx!.mailer.kind === "log"
          ? "log:// (messages go to the log, nothing is delivered)"
          : "SMTP server answers";
      });
      if (ctx!.settings.get(demoBoard))
        await check("demo board", () => {
          const host = new URL(config.publicUrl).hostname;
          if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
            throw new Error(
              `the sign-in page offers the demo accounts, Admin included, at ${config.publicUrl}; turn it off with \`postmodem settings set core.demo.enabled false\` and change the passwords`,
            );
          return "the sign-in page offers the demo accounts (local address only)";
        });
    }
    await ctx?.db.close();
  }

  for (const [ok, line] of results) console.log(`${ok ? "✓" : "✗"} ${line}`);
  return results.every(([ok]) => ok) ? 0 : 1;
}

/** POSTMODEM_DEMO: an empty board becomes the demo on start; any other board is left alone. */
async function demoOnStart(ctx: AppContext) {
  if (!ctx.config.demo || (await ctx.db.repos.nodes.tree()).length) return;
  const done = await setupDemo(ctx);
  if (done.outcome === "created")
    ctx.log.info("demo board created (POSTMODEM_DEMO)", {
      accounts: demoAccountsTable(ctx.config.publicUrl),
    });
}

async function demoCommand(args: string[]): Promise<number> {
  if (args.includes("--reset")) {
    const ctx = await createContext({ migrate: true });
    try {
      if (ctx.db.dialect !== "sqlite") {
        console.error(
          "demo --reset: only for SQLite boards. On a stack, remove its volumes instead (docker compose down -v).",
        );
        return 2;
      }
      if ((await ctx.db.repos.nodes.tree()).length && !(await isDemoBoard(ctx))) {
        console.error("demo --reset: this board isn't a demo board; nothing was deleted");
        return 2;
      }
      if ((await healthcheck()) === 0) {
        console.error(
          `demo --reset: a board answers on port ${ctx.config.port}, so this one may be running; stop it first (or set POSTMODEM_PORT to this board's port), then run this again`,
        );
        return 2;
      }
    } finally {
      await ctx.db.close();
    }
    const { config } = readConfig();
    const file = config.databaseUrl.slice("sqlite://".length);
    for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
    rmSync(uploadsDir(config.dataDir), { recursive: true, force: true });
    console.log("demo board deleted; building it again");
  }
  const ctx = await createContext({ migrate: true });
  try {
    const done = await setupDemo(ctx);
    if (done.outcome === "not-a-demo") {
      console.error(
        "demo: this board has content and isn't a demo board; nothing was changed (for demo content, start from an empty data directory)",
      );
      return 1;
    }
    console.log(
      done.outcome === "created" ? "demo board created" : "demo board: passwords and settings reset",
    );
    console.log(demoAccountsTable(ctx.config.publicUrl));
    return 0;
  } finally {
    await ctx.db.close();
  }
}

async function healthcheck(): Promise<number> {
  const { config } = readConfig();
  try {
    const res = await fetch(`http://127.0.0.1:${config.port}/healthz`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? 0 : 1;
  } catch {
    return 1;
  }
}

async function main(argv: string[]): Promise<number> {
  const [cmd = "run", sub] = argv;
  switch (cmd) {
    case "run": {
      const ctx = await createContext({ migrate: true, live: true });
      await demoOnStart(ctx);
      const web = await startWeb(ctx);
      startRole(ctx, "worker");
      startRole(ctx, "scheduler");
      onShutdown(ctx, [web]);
      return -1; // keep running
    }
    case "web": {
      const ctx = await createContext({ migrate: false, live: true });
      const r = await ctx.readiness();
      if (!r.ready)
        ctx.log.warn("not ready yet; /readyz will report 503 until resolved", { reason: r.reason });
      onShutdown(ctx, [await startWeb(ctx)]);
      return -1;
    }
    case "worker":
    case "scheduler": {
      const ctx = await createContext({ migrate: false });
      startRole(ctx, cmd);
      onShutdown(ctx, []);
      setInterval(() => {}, 1 << 30); // keep the event loop alive
      return -1;
    }
    case "migrate": {
      const ctx = await createContext({ migrate: false });
      const ran = await ctx.db.migrate();
      // Stack mode runs this role before the web servers: packages' tables too.
      const pkg = await ctx.db.migratePackages(packageMigrations(INSTALLED_PACKAGES, ctx.db.dialect));
      ctx.log.info(ran.length || pkg.length ? "migrations applied" : "database is up to date", {
        migrations: [...ran, ...pkg],
      });
      await demoOnStart(ctx);
      await ctx.db.close();
      return 0;
    }
    case "demo":
      return demoCommand(argv.slice(1));
    case "seed-demo": {
      const ctx = await createContext({ migrate: true });
      const longTopic = flag(argv.slice(1), "long-topic");
      if (longTopic !== undefined) {
        const posts = Number(longTopic);
        if (!Number.isInteger(posts) || posts < 1 || posts > 100_000) {
          console.error("seed-demo: --long-topic takes a number of posts (1–100000)");
          await ctx.db.close();
          return 2;
        }
        const added = await seedLongTopic(ctx.db.repos, posts);
        await rebuildSearch(ctx.db.repos, undefined, searchPlan(ctx.packages.searchContributions()));
        console.log(`added topic ${added.topicId} with ${posts} posts in forum ${added.forumId}`);
        await ctx.db.close();
        return 0;
      }
      const result = await seedDemo(
        ctx.db.repos,
        Date.now(),
        ctx.settings.get(defaultLocale),
        demoFiles(ctx),
      );
      if (result.created)
        await rebuildSearch(ctx.db.repos, undefined, searchPlan(ctx.packages.searchContributions()));
      if (result.created)
        ctx.log.info("demo board created", {
          ...result,
          logins: `Łukasz Żółć, retro_fan, Ola (moderator group), Kasia, Tom, Mika with password "${DEMO_PASSWORD}"`,
        });
      else ctx.log.warn("the board already has forums; demo content was not added");
      await ctx.db.close();
      return result.created ? 0 : 1;
    }
    case "init":
      return init(process.env);
    case "import":
      if (sub !== "przemo") break;
      return importBoard(argv.slice(2));
    case "user":
      if (sub === "set-password") return setPassword(argv.slice(2));
      if (sub === "expire-legacy-passwords") return expireLegacyPasswords(argv.slice(2));
      break;
    case "group":
      return groupCommand(sub, argv.slice(2));
    case "forum":
      return forumCommand(sub, argv.slice(2));
    case "ban":
      return banCommand(sub, argv.slice(2));
    case "invite":
      return inviteCommand(sub, argv.slice(2));
    case "packages":
      return packagesCommand(sub, argv.slice(2));
    case "backup": {
      const ctx = await createContext({ migrate: false });
      try {
        const dir = await backup(ctx, sub);
        console.log(`backup written to ${dir}`);
        return 0;
      } catch (e) {
        console.error(`backup failed: ${(e as Error).message}`);
        return 1;
      } finally {
        await ctx.db.close();
      }
    }
    case "restore": {
      if (!sub) break;
      const { config } = readConfig();
      try {
        const m = await restore(config.dataDir, config.databaseUrl, sub);
        console.log(`restored the backup of ${m.createdAt} (postmodem ${m.version}); start the board again`);
        return 0;
      } catch (e) {
        console.error(`restore failed: ${(e as Error).message}`);
        return 1;
      }
    }
    case "search": {
      if (sub !== "rebuild") break;
      const ctx = await createContext({ migrate: true });
      try {
        const n = await rebuildSearch(
          ctx.db.repos,
          (done) => done % 20_000 === 0 && console.log(`${done} posts…`),
          searchPlan(ctx.packages.searchContributions()),
        );
        await ctx.externalSearch?.rebuild();
        console.log(`search index rebuilt: ${n} posts`);
        return 0;
      } finally {
        await ctx.db.close();
      }
    }
    case "settings":
      if (sub !== "list" && sub !== "get" && sub !== "set") break;
      return settingsCommand(sub, argv.slice(2));
    case "perms":
      if (sub !== "explain") break;
      return permsExplain(argv.slice(2));
    case "doctor":
      return doctor();
    case "healthcheck":
      return healthcheck();
    case "config":
      if (sub !== "print") break;
      {
        const loaded = readConfig();
        for (const w of loaded.warnings) console.error(`warning: ${w}`);
        console.log(JSON.stringify(describeConfig(loaded), null, 2));
      }
      return 0;
    case "version": {
      const { config } = readConfig();
      console.log(`postmodem ${config.version} (${config.revision}) node ${process.version}`);
      return 0;
    }
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;
  }
  console.error(`unknown command: ${[cmd, sub].filter(Boolean).join(" ")}\n\n${HELP}`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (e) => {
    if (e instanceof ConfigError) console.error(`configuration error: ${e.message}`);
    else console.error(e);
    process.exit(1);
  },
);
