// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { nameKey, slugify } from "./names.ts";
import { childPath, depthOf, idsOf, isWithin, planMove, rootPath, TreeError } from "./tree.ts";

describe("tree paths", () => {
  it("builds and reads materialised paths", () => {
    const p = childPath(childPath(rootPath(1), 7), 12);
    expect(p).toBe("/1/7/12/");
    expect(depthOf(p)).toBe(2);
    expect(idsOf(p)).toEqual([1, 7, 12]);
    expect(isWithin(p, "/1/")).toBe(true);
    expect(isWithin("/10/", "/1/")).toBe(false); // prefix must end at a separator
  });

  it("plans moves and refuses cycles", () => {
    expect(planMove(7, "/1/7/", "/2/")).toBe("/2/7/");
    expect(planMove(7, "/1/7/", null)).toBe("/7/");
    expect(() => planMove(7, "/1/7/", "/1/7/12/")).toThrow(TreeError);
    expect(() => planMove(7, "/1/7/", "/1/7/")).toThrow(TreeError);
  });
});

describe("names", () => {
  it("normalises names for uniqueness", () => {
    expect(nameKey("  Łukasz   Żółć ")).toBe("łukasz żółć");
    expect(nameKey("ＡＤＭＩＮ")).toBe("admin"); // full-width letters fold
    expect(nameKey("Admin")).toBe(nameKey("admin"));
  });

  it("makes ASCII slugs with Polish transliteration", () => {
    expect(slugify("Zażółć gęślą jaźń")).toBe("zazolc-gesla-jazn");
    expect(slugify("Łódź & Gdańsk: 2026!")).toBe("lodz-gdansk-2026");
    expect(slugify("Straße Ærø")).toBe("strasse-aero");
    expect(slugify("¿¡!?")).toBe("");
    const long = slugify("bardzo długi tytuł tematu ".repeat(10), 40);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("-")).toBe(false);
  });
});
