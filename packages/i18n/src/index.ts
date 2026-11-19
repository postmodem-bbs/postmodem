// SPDX-License-Identifier: AGPL-3.0-or-later
// Fluent-based i18n (DESIGN.md §8): proper plural rules, per-locale fallback to English.
import { FluentBundle, FluentResource, type FluentVariable } from "@fluent/bundle";
import { negotiateLanguages } from "@fluent/langneg";
import en from "../locales/en/core.ftl?raw";
import pl from "../locales/pl/core.ftl?raw";

import { SUPPORTED, type SupportedLocale } from "./locales.ts";

export { SUPPORTED, type SupportedLocale };

const FALLBACK: SupportedLocale = "en";

const SOURCES: Record<SupportedLocale, string> = { en, pl };

function bundleFor(locale: SupportedLocale): FluentBundle {
  const bundle = new FluentBundle(locale, { useIsolating: false });
  const errors = bundle.addResource(new FluentResource(SOURCES[locale]));
  if (errors.length) throw new Error(`${locale}: ${errors.map((e) => e.message).join("; ")}`);
  return bundle;
}
const BUNDLES = new Map(SUPPORTED.map((l) => [l, bundleFor(l)]));

export type Translate = (id: string, args?: Record<string, FluentVariable>) => string;

/** Translator for a locale; missing messages fall back to English, then to the id itself. */
export function translator(locale: SupportedLocale): Translate {
  const chain =
    locale === FALLBACK ? [BUNDLES.get(FALLBACK)!] : [BUNDLES.get(locale)!, BUNDLES.get(FALLBACK)!];
  return (id, args) => {
    for (const bundle of chain) {
      const msg = bundle.getMessage(id);
      if (msg?.value) return bundle.formatPattern(msg.value, args);
    }
    return id;
  };
}

/** Pick a locale: explicit choice (query/cookie) → Accept-Language → board default. */
export function negotiate(opts: {
  requested?: string | null;
  acceptLanguage?: string | null;
  boardDefault?: string;
}): SupportedLocale {
  const fromHeader = (opts.acceptLanguage ?? "")
    .split(",")
    .map((p) => p.split(";")[0]!.trim())
    .filter(Boolean);
  const wanted = [opts.requested, ...fromHeader].filter((x): x is string => !!x);
  const def = (SUPPORTED as readonly string[]).includes(opts.boardDefault ?? "")
    ? opts.boardDefault!
    : FALLBACK;
  const [best] = negotiateLanguages(wanted, [...SUPPORTED], { defaultLocale: def, strategy: "lookup" });
  return (best ?? def) as SupportedLocale;
}

/** Message ids per locale, for the completeness test and future translation tooling. */
export function messageIds(locale: SupportedLocale): string[] {
  return [...SOURCES[locale].matchAll(/^([a-z][a-z0-9-]*)\s*=/gm)].map((m) => m[1]!);
}
