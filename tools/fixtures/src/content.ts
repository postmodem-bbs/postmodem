// SPDX-License-Identifier: AGPL-3.0-or-later
// Synthetic forum content in Polish and English, written as a phpBB2/Przemo board stored it:
// BBCode tags carry the per-post uid suffix (except [url]), lines end in \r\n.
import type { Rng } from "./rng.ts";

const PL = (
  "forum temat post odpowiedź pytanie problem rozwiązanie komputer karta grafika procesor dysk " +
  "płyta główna zasilacz monitor gra muzyka film książka samochód rower wakacje pogoda szkoła praca " +
  "dzięki pomoc proszę może jednak właśnie chyba naprawdę dobrze źle szybko wolno żółty zielony " +
  "łódź gęś jaźń żaba ślimak ćma źródło zażółć gęślą jaźń sprzęt sterownik aktualizacja instalacja"
).split(" ");
const EN = (
  "forum topic post reply question problem solution computer graphics card processor drive board " +
  "power supply monitor game music movie book car bike holiday weather school work thanks help " +
  "please maybe however exactly probably really good bad fast slow driver update install build"
).split(" ");
export const POLISH_PANGRAM = "Zażółć gęślą jaźń. Pchnąć w tę łódź jeża lub ośm skrzyń fig.";

/** Smiley codes as Przemo's default data stores them (note the HTML-escaped one). */
export const SMILIES = [
  ":-)",
  ";-)",
  ":-D",
  ":-P",
  ":-(",
  ":lol:",
  ":mrgreen:",
  ":shock:",
  ":cry:",
  ":idea:",
];

export interface Lang {
  words: readonly string[];
  code: "pl" | "en";
}
export const LANGS: Record<"pl" | "en", Lang> = {
  pl: { words: PL, code: "pl" },
  en: { words: EN, code: "en" },
};

/**
 * phpBB2's prepare_message: escape & (except numeric entities), <, > and " before storing.
 * The first pass then re-wrote quote tags with real quote marks around the name.
 */
export function phpbbStore(text: string): string {
  return text
    .replace(/&(?!#[0-9]+;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\[quote:([0-9a-f]{10})=&quot;(.*?)&quot;\]/g, '[quote:$1="$2"]');
}

export function sentence(rng: Rng, lang: Lang, min = 4, max = 14): string {
  const n = rng.int(min, max);
  const ws = Array.from({ length: n }, () => rng.pick(lang.words));
  ws[0] = ws[0]!.charAt(0).toUpperCase() + ws[0]!.slice(1);
  return `${ws.join(" ")}${rng.pick([".", ".", ".", "?", "!"])}`;
}

export function title(rng: Rng, lang: Lang): string {
  return sentence(rng, lang, 2, 7).replace(/[.?!]$/, "");
}

/** A post body with BBCode the way phpBB2 stored it. */
export function postBody(rng: Rng, lang: Lang, uid: string, quoteName?: string): string {
  const t = (tag: string, inner: string, arg?: string) =>
    `[${tag}${arg ? `=${arg}` : ""}:${uid}]${inner}[/${tag}:${uid}]`;
  const paras: string[] = [];
  const n = rng.int(1, 4);
  for (let i = 0; i < n; i++) {
    let p = Array.from({ length: rng.int(1, 3) }, () => sentence(rng, lang)).join(" ");
    const r = rng.next();
    if (r < 0.12) p = `${t("b", p.slice(0, 20))}${p.slice(20)}`;
    else if (r < 0.2) p = `${p} ${t("i", sentence(rng, lang, 2, 5))}`;
    else if (r < 0.26) p = `${p} [URL=http://example.org/${rng.hex(6)}]${title(rng, lang)}[/URL]`;
    else if (r < 0.3)
      p = `${p} ${t("color", sentence(rng, lang, 2, 4), rng.pick(["red", "#336699", "green"]))}`;
    else if (r < 0.33) p = `${t("size", p, String(rng.pick([9, 18, 24])))}`;
    else if (r < 0.36)
      p = `[code:1:${uid}]for (i = 0; i < 10; i++) {\r\n  echo "<b>" . $i;\r\n}[/code:1:${uid}]`;
    else if (r < 0.39)
      p = `[list:${uid}]\r\n[*]${title(rng, lang)}\r\n[*]${title(rng, lang)}\r\n[/list:u:${uid}]`;
    else if (r < 0.41)
      p = `${t("shadow", p, "red")}`; // Przemo-only tag
    else if (r < 0.43)
      p = `${t("center", p)}`; // Przemo-only tag
    else if (r < 0.45) p = `[img:${uid}]http://example.org/img/${rng.hex(8)}.png[/img:${uid}]`;
    if (rng.chance(0.15)) p += ` ${rng.pick(SMILIES)}`;
    paras.push(p);
  }
  if (quoteName) paras.unshift(`[quote:${uid}="${quoteName}"]${sentence(rng, lang)}[/quote:${uid}]`);
  return paras.join("\r\n\r\n");
}
