// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { guestPreferenceCookie, safeReturnPath } from "./preferences.ts";

const jar = (values: Record<string, string>) => ({ get: (name: string) => values[name] });

describe("preferences", () => {
  it("reads 0.1.0's theme and language cookies until the new cookie exists", () => {
    expect(JSON.parse(guestPreferenceCookie(jar({ pm_theme: "dark", pm_lang: "pl" }))!)).toEqual({
      "core.colorScheme": "dark",
      "core.language": "pl",
    });
    expect(guestPreferenceCookie(jar({ pm_prefs: "{}", pm_theme: "dark" }))).toBe("{}");
    expect(guestPreferenceCookie(jar({}))).toBeUndefined();
  });

  it("never redirects off-site", () => {
    expect(safeReturnPath("/forum/1?page=2")).toBe("/forum/1?page=2");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "", null]) {
      expect(safeReturnPath(bad)).toBe("/");
    }
  });
});
