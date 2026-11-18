// SPDX-License-Identifier: AGPL-3.0-or-later
// Search (M2 slice 6): what a query means. Words are folded like the index (foldForSearch),
// so diacritics don't matter; every word must match, and each matches as a prefix.
import { foldForSearch } from "./names.ts";

export const SEARCH_TERMS_MAX = 8;

/** The words of a query, folded, at least 2 characters, at most SEARCH_TERMS_MAX. */
export function searchTerms(q: string): string[] {
  const words = foldForSearch(q)
    .split(" ")
    .filter((w) => w.length >= 2);
  return [...new Set(words)].slice(0, SEARCH_TERMS_MAX);
}
