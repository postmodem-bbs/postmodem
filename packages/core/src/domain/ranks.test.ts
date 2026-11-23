// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { resolveRank } from "./ranks.ts";
import type { Rank } from "./types.ts";

const rank = (id: number, title: string, minPosts: number | null, special = false): Rank => ({
  id,
  title,
  titleKey: null,
  minPosts,
  special,
  image: null,
});
const ranks = [
  rank(1, "Newbie", 0),
  rank(2, "Regular", 50),
  rank(3, "Veteran", 500),
  rank(4, "Site admin", null, true),
];

describe("resolveRank (#130)", () => {
  it("picks the post-count rank with the highest minimum reached", () => {
    expect(resolveRank(ranks, { rankId: null, postCount: 0 })?.title).toBe("Newbie");
    expect(resolveRank(ranks, { rankId: null, postCount: 50 })?.title).toBe("Regular");
    expect(resolveRank(ranks, { rankId: null, postCount: 499 })?.title).toBe("Regular");
    expect(resolveRank(ranks, { rankId: null, postCount: 10_000 })?.title).toBe("Veteran");
  });

  it("gives a special rank precedence over post count", () => {
    expect(resolveRank(ranks, { rankId: 4, postCount: 10_000 })?.title).toBe("Site admin");
  });

  it("falls back to post count when the assigned rank is missing or not special", () => {
    expect(resolveRank(ranks, { rankId: 99, postCount: 60 })?.title).toBe("Regular");
    expect(resolveRank(ranks, { rankId: 3, postCount: 60 })?.title).toBe("Regular");
  });

  it("gives no rank when none is reached", () => {
    expect(resolveRank([rank(2, "Regular", 50)], { rankId: null, postCount: 3 })).toBeNull();
    expect(resolveRank([], { rankId: 4, postCount: 3 })).toBeNull();
  });
});
