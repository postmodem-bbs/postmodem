// SPDX-License-Identifier: AGPL-3.0-or-later
// Locale-aware dates. UTC until boards and users have time zone settings (M2), which also
// keeps server and client output identical.
export function formatDateTime(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(
    ms,
  );
}
export function formatDate(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(ms);
}
export const isoDate = (ms: number) => new Date(ms).toISOString();
