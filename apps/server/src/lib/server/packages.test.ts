// SPDX-License-Identifier: AGPL-3.0-or-later
import { coreSettings, enabledPackagesSetting, type PackageDefinition, Settings } from "@postmodem/core";
import { describe, expect, it } from "vitest";
import { createPackageHost } from "./packages.ts";

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
