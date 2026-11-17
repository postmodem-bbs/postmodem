// SPDX-License-Identifier: AGPL-3.0-or-later
// Username rules (M1 slice 4): Unicode letters/digits with a few separators, one script per
// name, and a "skeleton" so that names which merely look alike ("Admin" vs Cyrillic "Аdmin",
// "ola" vs "o1a") can't be registered next to each other.
import { nameKey } from "../domain/names.ts";

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 25; // phpBB2's limit, so imported names always fit

export type UsernameProblem =
  | "too-short"
  | "too-long"
  | "characters"
  | "edges"
  | "mixed-scripts"
  | "disallowed";

const ALLOWED = /^[\p{L}\p{M}\p{N} ._-]+$/u;
const SCRIPTS = [
  "Latin",
  "Cyrillic",
  "Greek",
  "Armenian",
  "Hebrew",
  "Arabic",
  "Han",
  "Hiragana",
  "Katakana",
  "Hangul",
  "Thai",
  "Georgian",
  "Devanagari",
];
const scriptRes = SCRIPTS.map((s) => [s, new RegExp(`\\p{Script=${s}}`, "u")] as const);

function scriptsOf(name: string): Set<string> {
  const found = new Set<string>();
  for (const ch of name) {
    if (!/\p{L}/u.test(ch)) continue;
    const hit = scriptRes.find(([, re]) => re.test(ch));
    found.add(hit ? hit[0] : "Other");
  }
  // Japanese legitimately mixes Han and kana.
  if (found.has("Han") && (found.has("Hiragana") || found.has("Katakana"))) {
    found.delete("Hiragana");
    found.delete("Katakana");
  }
  return found;
}

// Characters that look like Latin letters (a subset of Unicode's confusables.txt covering the
// scripts that actually get abused), plus digits and separators that pass for letters.
const LOOKALIKES: Record<string, string> = {
  // Cyrillic
  а: "a",
  в: "b",
  е: "e",
  ё: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  ѕ: "s",
  і: "l",
  ї: "l",
  ј: "j",
  ԁ: "d",
  ԛ: "q",
  ԝ: "w",
  ү: "y",
  һ: "h",
  ӏ: "l",
  ь: "b",
  // Greek
  α: "a",
  β: "b",
  ε: "e",
  η: "n",
  ι: "l",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
  ϲ: "c",
  ϳ: "j",
  // Digits and separators
  "0": "o",
  "1": "l",
  "3": "e",
  "5": "s",
  "8": "b",
  "|": "l",
  _: "",
  "-": "",
  ".": "",
  " ": "",
  // Latin letters that collapse into each other ("rn" → "m" and "vv" → "w" are done first)
  i: "l",
  ı: "l",
  ł: "l",
  ɩ: "l",
  ʟ: "l",
  ⅰ: "l",
  ⅼ: "l",
};

/** Lookalike-folded form; two names with the same skeleton are treated as the same name. */
export function skeleton(name: string): string {
  let s = nameKey(name).normalize("NFKD").replace(/\p{M}/gu, "");
  s = s.replace(/rn/g, "m").replace(/vv/g, "w");
  return [...s].map((ch) => LOOKALIKES[ch] ?? ch).join("");
}

/** phpBB2's "disallow" list semantics: case-insensitive, `*` matches anything. */
export function isDisallowed(name: string, patterns: readonly string[]): boolean {
  const key = nameKey(name);
  const skel = skeleton(name);
  return patterns.some((p) => {
    const re = new RegExp(
      `^${nameKey(p)
        .split("*")
        .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")}$`,
      "u",
    );
    return re.test(key) || (!p.includes("*") && skeleton(p) === skel);
  });
}

export function usernameProblem(raw: string, disallowed: readonly string[] = []): UsernameProblem | null {
  const name = raw.normalize("NFC");
  const length = [...name].length;
  if (length < USERNAME_MIN) return "too-short";
  if (length > USERNAME_MAX) return "too-long";
  if (!ALLOWED.test(name)) return "characters";
  if (/^[ ._-]|[ ._-]$|[ ._-]{2}/u.test(name)) return "edges";
  if (scriptsOf(name).size > 1) return "mixed-scripts";
  if (isDisallowed(name, disallowed)) return "disallowed";
  return null;
}

/** Tidies what people type: NFC, trimmed, inner whitespace collapsed. */
export const cleanUsername = (raw: string) => raw.normalize("NFC").trim().replace(/\s+/g, " ");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const emailProblem = (email: string): "invalid" | null =>
  email.length <= 254 && EMAIL.test(email) ? null : "invalid";
