// SPDX-License-Identifier: AGPL-3.0-or-later
// Normalisation for uniqueness keys and URL slugs.

/**
 * Key used to enforce unique usernames/group names: NFKC (folds full-width and compatibility
 * forms), case-folded, whitespace collapsed. "Łukasz  Żółć" and "łukasz żółć" collide.
 * Confusable-character checks (Cyrillic "а" vs Latin "a") come with registration (M1 slice 4).
 */
export function nameKey(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("und").trim().replace(/\s+/g, " ");
}

// Letters that don't decompose into ASCII + combining mark under NFKD.
const TRANSLITERATE: Record<string, string> = {
  ł: "l",
  Ł: "l",
  đ: "d",
  Đ: "d",
  ø: "o",
  Ø: "o",
  ß: "ss",
  æ: "ae",
  Æ: "ae",
  œ: "oe",
  Œ: "oe",
  þ: "th",
  Þ: "th",
};

/**
 * URL slug (ADR 0012): ASCII, lowercase, hyphen-separated, at most `max` characters,
 * cut at a word boundary. Polish and other Latin diacritics are transliterated
 * ("Zażółć gęślą jaźń" → "zazolc-gesla-jazn"). Returns "" if nothing usable remains;
 * callers fall back to the numeric id.
 */
export function slugify(text: string, max = 80): string {
  const ascii = [...text]
    .map((ch) => TRANSLITERATE[ch] ?? ch)
    .join("")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii.length <= max) return ascii;
  const cut = ascii.slice(0, max + 1);
  const lastHyphen = cut.lastIndexOf("-");
  return (lastHyphen > max / 2 ? cut.slice(0, lastHyphen) : ascii.slice(0, max)).replace(/-+$/, "");
}

/**
 * Text as the search index stores it: lowercase ASCII words, Polish and other Latin letters
 * transliterated like slugs, so "Łódź" and "lodz" find each other.
 */
export function foldForSearch(text: string): string {
  return [...text]
    .map((ch) => TRANSLITERATE[ch] ?? ch)
    .join("")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Username slugs are shorter than title slugs. */
export const USER_SLUG_MAX = 40;
