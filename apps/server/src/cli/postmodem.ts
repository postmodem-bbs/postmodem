#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// The `postmodem` CLI: one image, many roles (CONTAINERS.md §2.2).
import { accessSync, constants, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ConfigError,
  cleanUsername,
  describeConfig,
  emailProblem,
  hashPassword,
  installCorePermissions,
  PASSWORD_MIN,
  passwordProblem,
  usernameProblem,
} from "@postmodem/core";
import { type AppContext, createContext, readConfig } from "../lib/server/bootstrap.ts";
import { DEMO_PASSWORD, seedDemo } from "../lib/server/demo.ts";

const HELP = `postmodem — a modern bulletin board

Usage: postmodem <command>

  run           web + worker + scheduler in one process (solo mode, default)
  web           HTTP server only
  worker        background job worker
  scheduler     periodic job scheduler (run exactly one)
  migrate       apply database migrations and exit
  doctor        check configuration, data directory and database
  init          create the first administrator from POSTMODEM_ADMIN_* (idempotent)
  seed-demo     fill an empty board with demo content (refuses if forums exist)
  perms explain --user <name|guest> --capability <key> [--node <id>]
                show whether a user may do something, and which grants decided it
  user set-password <name> [--password-file <path>]
                set a password (prompted, read from stdin, or from a file); signs the
                user out everywhere and activates a pending account
  healthcheck   exit 0 if the local web server answers /healthz
  config print  show the effective configuration (secrets redacted)
  version       print version information
`;

const SHUTDOWN_GRACE_MS = 25_000;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
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
    const problem = passwordProblem(password, [user.username, user.email ?? ""]);
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

async function startWeb(ctx: AppContext): Promise<Server> {
  const { config } = ctx;
  // adapter-node reads these when the handler module loads.
  process.env.ORIGIN ??= config.publicUrl;
  if (config.trustedProxies.length) {
    process.env.ADDRESS_HEADER ??= "x-forwarded-for";
    process.env.XFF_DEPTH ??= "1";
    process.env.PROTOCOL_HEADER ??= "x-forwarded-proto";
  }
  globalThis.__postmodem = Promise.resolve(ctx);
  const handlerUrl = pathToFileURL(join(import.meta.dirname, "handler.js")).href;
  const { handler } = (await import(handlerUrl)) as { handler: (req: unknown, res: unknown) => void };
  const server = createServer(handler as never);
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  ctx.log.info("web server listening", { host: config.host, port: config.port, publicUrl: config.publicUrl });
  return server;
}

function startRole(ctx: AppContext, role: "worker" | "scheduler") {
  if (role === "worker") {
    ctx.worker.start();
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
      if (sessions + jobs + throttle) ctx.log.info("housekeeping", { sessions, jobs, throttle });
    } catch (e) {
      ctx.log.warn("housekeeping failed", { error: (e as Error).message });
    }
  };
  setInterval(purge, 3600_000).unref();
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
    await installCorePermissions(repos);
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
    await Promise.all([...servers.map((s) => new Promise((r) => s.close(r))), ctx.worker.stop()]);
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
    }
    await ctx?.db.close();
  }

  for (const [ok, line] of results) console.log(`${ok ? "✓" : "✗"} ${line}`);
  return results.every(([ok]) => ok) ? 0 : 1;
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
      const ctx = await createContext({ migrate: true });
      const web = await startWeb(ctx);
      startRole(ctx, "worker");
      startRole(ctx, "scheduler");
      onShutdown(ctx, [web]);
      return -1; // keep running
    }
    case "web": {
      const ctx = await createContext({ migrate: false });
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
      ctx.log.info(ran.length ? "migrations applied" : "database is up to date", { migrations: ran });
      await ctx.db.close();
      return 0;
    }
    case "seed-demo": {
      const ctx = await createContext({ migrate: true });
      const result = await seedDemo(ctx.db.repos);
      if (result.created)
        ctx.log.info("demo board created", {
          ...result,
          logins: `Łukasz Żółć, retro_fan, Ola (moderator group) with password "${DEMO_PASSWORD}"`,
        });
      else ctx.log.warn("the board already has forums; demo content was not added");
      await ctx.db.close();
      return result.created ? 0 : 1;
    }
    case "init":
      return init(process.env);
    case "user":
      if (sub !== "set-password") break;
      return setPassword(argv.slice(2));
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
