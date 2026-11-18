// SPDX-License-Identifier: AGPL-3.0-or-later
// Locale-aware dates. UTC until boards and users have time zone settings (M2), which also
// keeps server and client output identical. Formatters are costly to build, so each is
// built once per locale (a topic page formats dozens of dates).
const dateTimes = new Map<string, Intl.DateTimeFormat>();
const dates = new Map<string, Intl.DateTimeFormat>();

function formatter(
  cache: Map<string, Intl.DateTimeFormat>,
  locale: string,
  opts: Intl.DateTimeFormatOptions,
) {
  let f = cache.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" });
    cache.set(locale, f);
  }
  return f;
}

export function formatDateTime(ms: number, locale: string): string {
  return formatter(dateTimes, locale, { dateStyle: "medium", timeStyle: "short" }).format(ms);
}
export function formatDate(ms: number, locale: string): string {
  return formatter(dates, locale, { dateStyle: "medium" }).format(ms);
}
export const isoDate = (ms: number) => new Date(ms).toISOString();
