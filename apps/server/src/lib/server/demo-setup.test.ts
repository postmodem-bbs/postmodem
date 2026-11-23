// SPDX-License-Identifier: AGPL-3.0-or-later
// `postmodem demo` (#162): an empty board becomes the demo; a demo board gets its passwords and
// settings back; any other board is left alone.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authenticate, demoBoard, floodSeconds, verifyEmailOnRegistration } from "@postmodem/core";
import { afterEach, describe, expect, it } from "vitest";
import { type AppContext, createContext } from "./bootstrap.ts";
import { DEMO_PASSWORD } from "./demo.ts";
import { DEMO_ACCOUNTS, demoAccountsTable, isDemoBoard, setupDemo } from "./demo-setup.ts";

describe("demo setup", () => {
  const saved = { ...process.env };
  let ctx: AppContext | undefined;
  afterEach(async () => {
    await ctx?.db.close();
    ctx = undefined;
    process.env = { ...saved };
  });
  async function board() {
    process.env.POSTMODEM_DATA_DIR = mkdtempSync(join(tmpdir(), "pm-demo-"));
    process.env.POSTMODEM_LOG_LEVEL = "error";
    ctx = await createContext({ migrate: true });
    return ctx;
  }

  it("seeds an empty board, opens every account with the demo password and applies the demo settings", async () => {
    const c = await board();
    expect(await isDemoBoard(c)).toBe(false);
    const done = await setupDemo(c);
    expect(done.outcome).toBe("created");
    for (const { username } of DEMO_ACCOUNTS) {
      const signedIn = await authenticate(c.db.repos, username, DEMO_PASSWORD);
      expect(signedIn.ok, username).toBe(true);
    }
    expect(c.settings.get(demoBoard)).toBe(true);
    expect(c.settings.get(verifyEmailOnRegistration)).toBe(false);
    expect(c.settings.get(floodSeconds)).toBe(0);
    expect(await isDemoBoard(c)).toBe(true);
  });

  it("puts forgotten passwords and changed settings back on a demo board, without seeding twice", async () => {
    const c = await board();
    await setupDemo(c);
    const forums = (await c.db.repos.nodes.tree()).length;
    const admin = (await c.db.repos.users.byUsername("Admin"))!;
    await c.db.repos.credentials.set(admin.id, "argon2id", "not-a-real-hash");
    await c.settings.set(floodSeconds, 30);

    expect((await setupDemo(c)).outcome).toBe("refreshed");
    expect((await authenticate(c.db.repos, "Admin", DEMO_PASSWORD)).ok).toBe(true);
    expect(c.settings.get(floodSeconds)).toBe(0);
    expect((await c.db.repos.nodes.tree()).length).toBe(forums);
  });

  it("recognises a board filled by `seed-demo` alone as a demo", async () => {
    const c = await board();
    const { seedDemo } = await import("./demo.ts");
    await seedDemo(c.db.repos);
    expect(c.settings.get(demoBoard)).toBe(false);
    expect((await setupDemo(c)).outcome).toBe("refreshed");
    expect((await authenticate(c.db.repos, "Admin", DEMO_PASSWORD)).ok).toBe(true);
  });

  it("never touches a board that isn't a demo", async () => {
    const c = await board();
    await c.db.repos.nodes.create({ parentId: null, kind: "forum", title: "Our real forum", position: 1 });
    expect((await setupDemo(c)).outcome).toBe("not-a-demo");
    expect(c.settings.get(demoBoard)).toBe(false);
    expect(await c.db.repos.users.byUsername("Admin")).toBeUndefined();
  });

  it("prints every account and the shared password", () => {
    const table = demoAccountsTable("http://localhost:8080");
    expect(table).toContain(DEMO_PASSWORD);
    for (const { username } of DEMO_ACCOUNTS) expect(table).toContain(username);
  });
});
