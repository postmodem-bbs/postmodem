// SPDX-License-Identifier: AGPL-3.0-or-later
// phpBB2's ranks (#130): a special rank an admin gives a member, else the post-count rank
// whose minimum the member has reached. Group ranks and custom rank text are `ranks-plus`.
import type { Rank } from "./types.ts";

export const RANK_TITLE_MAX = 50;

/**
 * The rank a member shows. phpBB2 showed no rank at all when `user_rank` named a rank that
 * isn't special; Postmodem falls back to the post-count rank instead, so a rank turned from
 * special into a post-count rank doesn't leave its members without one.
 */
export function resolveRank(
  ranks: readonly Rank[],
  member: { rankId: number | null; postCount: number },
): Rank | null {
  if (member.rankId !== null) {
    const assigned = ranks.find((r) => r.id === member.rankId);
    if (assigned?.special) return assigned;
  }
  let best: Rank | null = null;
  for (const r of ranks)
    if (!r.special && r.minPosts !== null && r.minPosts <= member.postCount)
      if (!best || r.minPosts > (best.minPosts ?? -1)) best = r;
  return best;
}
