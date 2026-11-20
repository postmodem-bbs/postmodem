// SPDX-License-Identifier: AGPL-3.0-or-later
import { coreSettings, deleteAccount, enabledPackagesSetting, Settings } from "@postmodem/core";
import { openTestDatabase, testEngines } from "@postmodem/db/testing";
import { IP_LOG_RETENTION_DAYS, ipLogStore } from "@postmodem/modules";
import { describe, expect, it } from "vitest";
import { createPackageHost, INSTALLED_PACKAGES, packageMigrations } from "./packages.ts";

describe.each(testEngines())("IP logging on %s", (engine) => {
  it("validates client addresses and retains personal-data handling after disablement", async () => {
    const db = await openTestDatabase(engine);
    try {
      await db.migrate();
      const installed = INSTALLED_PACKAGES.filter((pkg) => pkg.key === "ip-logging");
      await db.migratePackages(packageMigrations(installed, db.dialect));
      const repos = db.repos;
      const settings = new Settings(coreSettings(), { loadAll: async () => new Map(), save: async () => {} });
      const opts = {
        repos,
        db: repos.raw,
        settings,
        profile: "przemo" as const,
        log: { error: () => {} } as never,
        platform: {} as never,
      };
      const host = await createPackageHost({ ...opts, installed });
      const actor = await repos.users.create({ username: "member", email: null, status: "active" });
      const now = Date.now();
      const request = { via: "web" as const, locale: "en", timezone: null, userAgent: "private agent" };
      await host.emit("auth.signedIn", { actor, now }, { ...request, ip: "not an address" });
      await host.emit("auth.signedIn", { actor, now }, { ...request, ip: "2001:db8::1" });
      expect((await host.exportPersonal(actor.id))["ip-logging"]).toEqual([
        { userId: actor.id, ip: "2001:db8::1", kind: "sign-in", at: now },
      ]);
      await settings.set(enabledPackagesSetting, []);
      await host.emit("auth.signedIn", { actor, now }, { ...request, ip: "192.0.2.1" });
      const store = ipLogStore(repos.raw);
      const old = now - (IP_LOG_RETENTION_DAYS + 1) * 86_400_000;
      await store.add({ userId: actor.id, at: old, ip: "192.0.2.2", kind: "legacy" });
      expect(await host.housekeeping(now)).toBe(1);
      expect(await store.forUser(actor.id)).toHaveLength(1);
      const unavailable = await createPackageHost({
        ...opts,
        installed: installed.map((pkg) => ({
          ...pkg,
          setup: () => {
            throw new Error("Package startup failed");
          },
        })),
      });
      await expect(unavailable.exportPersonal(actor.id)).rejects.toThrow(
        "Privacy handlers unavailable for package ip-logging",
      );
      await expect(
        repos.transaction(async (tx) => {
          await deleteAccount(tx, actor, { posts: "keep", deletedName: "Deleted user" });
          await unavailable.erasePersonal(actor.id, tx);
        }),
      ).rejects.toThrow("Privacy handlers unavailable for package ip-logging");
      expect(await repos.users.get(actor.id)).toMatchObject({ status: "active" });
      expect(await store.forUser(actor.id)).toHaveLength(1);

      await repos.transaction((tx) => host.erasePersonal(actor.id, tx));
      expect(await store.forUser(actor.id)).toEqual([]);
    } finally {
      await db.close();
    }
  });
});
