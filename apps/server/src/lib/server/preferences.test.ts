// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseTheme, safeReturnPath } from "./preferences.ts";

describe("preferences", () => {
  it("accepts only known themes", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("hotdog")).toBe("system");
    expect(parseTheme(undefined)).toBe("system");
  });

  it("never redirects off-site", () => {
    expect(safeReturnPath("/forum/1?page=2")).toBe("/forum/1?page=2");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "", null]) {
      expect(safeReturnPath(bad)).toBe("/");
    }
  });
});
