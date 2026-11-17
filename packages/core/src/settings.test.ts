// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { boardName, coreSettings } from "./core-settings.ts";
import { defineSetting, Settings, type SettingsStore, SettingValidationError } from "./settings.ts";

const memoryStore = (
  initial: Record<string, unknown> = {},
): SettingsStore & { data: Map<string, unknown> } => {
  const data = new Map(Object.entries(initial));
  return { data, loadAll: async () => new Map(data), save: async (k, v) => void data.set(k, v) };
};

describe("Settings", () => {
  it("returns defaults until a value is set, then persists validated values", async () => {
    const store = memoryStore();
    const s = new Settings(coreSettings(), store);
    await s.init();
    expect(s.get(boardName)).toBe("Postmodem");
    await s.set(boardName, "  Retro Corner  ");
    expect(s.get(boardName)).toBe("Retro Corner");
    expect(store.data.get("core.board.name")).toBe("Retro Corner");
  });

  it("rejects invalid values and leaves the old value in place", async () => {
    const s = new Settings(coreSettings(), memoryStore());
    await s.init();
    await expect(s.set(boardName, "")).rejects.toThrow(SettingValidationError);
    expect(s.get(boardName)).toBe("Postmodem");
  });

  it("falls back to the default when a stored value no longer validates", async () => {
    const s = new Settings(coreSettings(), memoryStore({ "core.board.name": 42 }));
    expect(await s.init()).toEqual(["stored value for 'core.board.name' is invalid; using the default"]);
    expect(s.get(boardName)).toBe("Postmodem");
  });

  it("validates keys and defaults at definition time", () => {
    expect(() => defineSetting({ key: "Bad Key", schema: z.string(), default: "" })).toThrow(
      /invalid setting key/,
    );
    expect(() => defineSetting({ key: "x.y.z", schema: z.number(), default: "no" as never })).toThrow(
      /default/,
    );
  });
});
