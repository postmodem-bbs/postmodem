// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  coreSettings,
  deleteAccount,
  enabledPackagesSetting,
  MemoryThrottleStore,
  type PackageDefinition,
  type RenderReader,
  type Repositories,
  type Session,
  Settings,
} from "@postmodem/core";
import { openTestDatabase, testEngines } from "@postmodem/db/testing";
import { loginSecuritySettings, reportsStore } from "@postmodem/modules";
import { describe, expect, it } from "vitest";
import { createPackageHost, INSTALLED_PACKAGES, packageMigrations } from "./packages.ts";

const viewer = { userId: 1, groupIds: [] };
const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } as never;

describe("package host", () => {
  it("follows the enabled setting live and keeps a failing package from breaking the page", async () => {
    const seen: string[] = [];
    const good: PackageDefinition = {
      key: "good",
      name: "Good",
      description: "",
      tier: 1,
      version: "0",
      setup: () => ({
        on: { "topic.viewed": () => void seen.push("good") },
        slots: { "forum.tools": () => [{ kind: "link", key: "g", label: "x", href: "/g" }] },
        decorateTopics: async () => new Map([[7, { badges: [{ key: "n", label: "new" }] }]]),
      }),
    };
    const bad: PackageDefinition = {
      key: "bad",
      name: "Bad",
      description: "",
      tier: 1,
      version: "0",
      setup: () => ({
        on: {
          "topic.viewed": () => {
            throw new Error("boom");
          },
        },
        slots: {
          "forum.tools": () => {
            throw new Error("boom");
          },
        },
      }),
    };
    const settings = new Settings(coreSettings(), { loadAll: async () => new Map(), save: async () => {} });
    await settings.init();
    const errors: string[] = [];
    const log = { ...(quiet as object), error: (m: string) => errors.push(m) } as never;
    const host = await createPackageHost({
      installed: [good, bad],
      repos: {} as never,
      db: null,
      settings,
      profile: "vanilla",
      log,
      platform: {} as never,
    });

    // The vanilla profile enables nothing.
    expect(host.enabled()).toEqual([]);
    await settings.set(enabledPackagesSetting, ["good", "bad", "not-installed"]);
    expect(host.enabled().sort()).toEqual(["bad", "good"]);

    await host.emit("topic.viewed", { topic: {} as never, viewer, lastPostAt: 1 });
    expect(seen).toEqual(["good"]);
    const args = { viewer, perms: {} as never, user: null };
    expect((await host.slot("forum.tools", args)).map((i) => i.key)).toEqual(["g"]);
    expect((await host.decorateTopics(viewer, [])).get(7)).toEqual([
      { badges: [{ key: "n", label: "new" }] },
    ]);
    expect(errors.length).toBe(2);

    await settings.set(enabledPackagesSetting, ["bad"]);
    expect(await host.slot("forum.tools", args)).toEqual([]);
  });
});

it("applies login-security only while enabled and preserves independent attempt keys", async () => {
  const settings = new Settings(coreSettings().register(...Object.values(loginSecuritySettings)), {
    loadAll: async () => new Map(),
    save: async () => {},
  });
  const host = await createPackageHost({
    installed: INSTALLED_PACKAGES.filter((pkg) => pkg.key === "login-security"),
    repos: { throttle: new MemoryThrottleStore() } as unknown as Repositories,
    db: null,
    settings,
    profile: "essentials",
    log: quiet,
    platform: {} as never,
  });
  await settings.set(loginSecuritySettings.maxFailures, 2);
  await settings.set(loginSecuritySettings.minPasswordLength, 12);
  await settings.set(loginSecuritySettings.requireLettersAndNumbers, true);
  await settings.set(loginSecuritySettings.bindSessionIp, true);
  const attempt = { identifier: "member", ip: "192.0.2.1", now: 5000 };
  const session = { ip: attempt.ip } as Session;
  const user = { username: "member", email: null };
  await Promise.all([host.loginResult(attempt, false), host.loginResult(attempt, false)]);
  expect(await host.loginWait(attempt)).toBe(60_000);
  expect(await host.loginWait({ ...attempt, now: attempt.now + 60_000 })).toBe(0);
  expect(await host.loginWait({ ...attempt, ip: "192.0.2.2" })).toBe(0);
  expect(host.passwordPolicy("shorter123", user)).toBe("package-min-length");
  expect(host.passwordPolicy("a longer password", user)).toBe("letters-and-numbers");
  expect(host.passwordPolicy("a longer password 1", user)).toBeUndefined();
  expect(host.validateSession(session, attempt.ip)).toBe(true);
  expect(host.validateSession(session, "192.0.2.2")).toBe(false);

  await settings.set(enabledPackagesSetting, []);
  expect(await host.loginWait(attempt)).toBe(0);
  expect(host.passwordPolicy("shorter123", user)).toBeUndefined();
  expect(host.validateSession(session, "192.0.2.2")).toBe(true);

  await settings.set(enabledPackagesSetting, ["login-security"]);
  await host.loginResult(attempt, true);
  expect(await host.loginWait(attempt)).toBe(0);
});

describe.each(testEngines())("package privacy on %s", (engine) => {
  it("exports only the member's reports and rolls back erasure if a disabled package fails", async () => {
    const db = await openTestDatabase(engine);
    try {
      const reports = INSTALLED_PACKAGES.find((pkg) => pkg.key === "reports")!;
      const failing: PackageDefinition = {
        key: "failing",
        name: "Failing",
        description: "",
        tier: 2,
        version: "0",
        personalData: { purpose: "Test data" },
        setup: () => ({
          privacy: {
            export: async () => [],
            erase: async () => {
              throw new Error("Cannot erase");
            },
          },
        }),
      };
      await db.migrate();
      await db.migratePackages(packageMigrations([reports], db.dialect));
      const { repos } = db;
      const settings = new Settings(coreSettings(), { loadAll: async () => new Map(), save: async () => {} });
      const opts = {
        repos,
        db: repos.raw,
        settings,
        profile: "vanilla" as const,
        log: quiet,
        platform: {} as never,
      };
      const host = await createPackageHost({ ...opts, installed: [reports, failing] });
      const user = await repos.users.create({
        username: "reporter",
        email: "reporter@example.test",
        status: "active",
      });
      const store = reportsStore(repos.raw);
      const filed = await store.create({ reporterId: user.id, postId: 1, reason: "My report" });
      const other = await store.create({ reporterId: user.id + 1, postId: 1, reason: "Other report" });
      await store.close(filed.id, 100, "Reviewed");

      expect(host.isEnabled("reports")).toBe(false);
      const exported = await host.exportPersonal(user.id);
      expect(exported.reports).toEqual([
        expect.objectContaining({ id: filed.id, reason: "My report", status: "closed", outcome: "Reviewed" }),
      ]);
      expect(JSON.stringify(exported)).not.toMatch(/closedBy|reporterId|Other report/);

      const erase = (packages: typeof host) =>
        repos.transaction(async (tx) => {
          await deleteAccount(tx, user, { posts: "keep", deletedName: "Deleted user" });
          await packages.erasePersonal(user.id, tx);
        });
      await expect(erase(host)).rejects.toThrow("Cannot erase");
      expect(await repos.users.get(user.id)).toMatchObject({ status: "active", email: user.email });
      expect(await store.get(filed.id)).toBeDefined();

      await erase(await createPackageHost({ ...opts, installed: [reports] }));
      expect(await repos.users.get(user.id)).toMatchObject({ status: "deleted", email: null });
      expect(await store.get(filed.id)).toBeUndefined();
      expect(await store.get(other.id)).toBeDefined();
    } finally {
      await db.close();
    }
  });
});

it("reveals hide blocks only for eligible readers while the package is enabled", async () => {
  const settings = new Settings(coreSettings(), { loadAll: async () => new Map(), save: async () => {} });
  let lookups = 0;
  const repos = {
    posts: {
      async hasReply(topicId: number, authorId: number, firstPostId: number) {
        lookups++;
        expect([topicId, firstPostId]).toEqual([7, 12]);
        return authorId === 2;
      },
    },
  } as unknown as Repositories;
  const host = await createPackageHost({
    installed: INSTALLED_PACKAGES.filter((pkg) => pkg.key === "hide-until-reply"),
    repos,
    db: null,
    settings,
    profile: "essentials",
    log: quiet,
    platform: {} as never,
  });
  const key = host.renderTags.get("hide")!;
  const visible = (userId: number | null, bypass = false) =>
    host.visibleRenderHoles(
      {
        topic: { id: 7, firstPostId: 12, authorId: 3 },
        node: {},
        perms: {
          viewer: { userId },
          can: (cap: string) => cap === "hide.bypass" && bypass,
        },
      } as unknown as RenderReader,
      new Set([key]),
    );
  expect(await visible(null)).toEqual(new Set());
  expect(await visible(1, true)).toEqual(new Set([key]));
  expect(lookups).toBe(0);
  expect(await visible(1)).toEqual(new Set());
  expect(await visible(2)).toEqual(new Set([key]));
  expect(lookups).toBe(2);
  // The topic's author reads their own hidden text without a reply.
  expect(await visible(3)).toEqual(new Set([key]));
  expect(lookups).toBe(2);
  await settings.set(enabledPackagesSetting, []);
  expect(await visible(2, true)).toEqual(new Set());
  expect(lookups).toBe(2);
});
