// SPDX-License-Identifier: AGPL-3.0-or-later
// The ranks a new board starts with (#130), as phpBB2's installer gave its admin "Site Admin".
// Their badges ship with the app (static/ranks/default/<lang>/) and, like their titles, follow
// each reader's language, as phpBB2's language packs did. They are never uploaded: SVG is refused as an upload. Seeded once, on a board with no ranks yet.
import type { Rank, Repositories } from "@postmodem/core";
import { type SupportedLocale, translator } from "@postmodem/i18n";

export const DEFAULT_RANKS = ["owner", "admin", "mod", "vip", "user"] as const;
export type DefaultRank = (typeof DEFAULT_RANKS)[number];

/** Creates the default ranks unless the board has ranks already; returns them by key. */
export async function seedDefaultRanks(
  repos: Repositories,
  locale: SupportedLocale,
): Promise<Map<DefaultRank, Rank> | null> {
  if ((await repos.ranks.all()).length) return null;
  const t = translator(locale);
  const out = new Map<DefaultRank, Rank>();
  for (const key of DEFAULT_RANKS) {
    // Every badge but "user" is given to members one by one; "user" is everyone's from post 0.
    const special = key !== "user";
    out.set(
      key,
      await repos.ranks.create({
        // The title as typed is the board's language; readers see theirs through the key.
        title: t(`rank-default-${key}`),
        titleKey: `rank-default-${key}`,
        special,
        minPosts: special ? null : 0,
        image: `default/{LANG}/rank_${key}.svg`,
      }),
    );
  }
  return out;
}
