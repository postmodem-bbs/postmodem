#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// The `postmodem` CLI: one image, many roles (CONTAINERS.md §2.2).
import { accessSync, constants, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigError, describeConfig } from "@postmodem/core";
import { type AppContext, createContext, readConfig } from "../lib/server/bootstrap.ts";

const HELP = `postmodem — a modern bulletin board

Usage: postmodem <command>

  run           web + worker + scheduler in one process (solo mode, default)
  web           HTTP server only
  worker        background job worker
  scheduler     periodic job scheduler (run exactly one)
  migrate       apply database migrations and exit
  doctor        check configuration, data directory and database
  healthcheck   exit 0 if the local web server answers /healthz
  config print  show the effective configuration (secrets redacted)
  version       print version information
`;

const SHUTDOWN_GRACE_MS = 25_000;

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

function startIdleRole(ctx: AppContext, role: "worker" | "scheduler") {
  ctx.log.info(`${role} started`, { note: "no job types are registered yet (M0)" });
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
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
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
      startIdleRole(ctx, "worker");
      startIdleRole(ctx, "scheduler");
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
      startIdleRole(ctx, cmd);
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
