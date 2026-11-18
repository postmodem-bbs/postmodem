// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { normaliseStart, paginate } from "./pagination.ts";

describe("pagination", () => {
  it("shows first, last and neighbours with gaps", () => {
    const p = paginate(300, 25, 125); // page 6 of 12
    expect(p.current).toBe(6);
    expect(p.links.map((l) => l?.number ?? "…")).toEqual([1, "…", 4, 5, 6, 7, 8, "…", 12]);
    expect(p.prev?.start).toBe(100);
    expect(p.next?.start).toBe(150);
  });

  it("handles single pages and clamps bad offsets", () => {
    expect(paginate(0, 25, 0)).toMatchObject({ current: 1, total: 1, prev: null, next: null });
    expect(normaliseStart("37", 15, 100)).toBe(30);
    expect(normaliseStart("-5", 15, 100)).toBe(0);
    expect(normaliseStart("9999", 15, 100)).toBe(90);
    expect(normaliseStart("abc", 15, 0)).toBe(0);
  });
});
