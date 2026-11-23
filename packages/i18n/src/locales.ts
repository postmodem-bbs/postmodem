// SPDX-License-Identifier: AGPL-3.0-or-later
// The supported languages, without the translations: for code that only needs the list (the
// CLI bundle has no loader for .ftl files).
export const SUPPORTED = ["en", "pl"] as const;
export type SupportedLocale = (typeof SUPPORTED)[number];
/** Each language in its own words, for language pickers. */
export const LANGUAGE_NAMES: Record<SupportedLocale, string> = { en: "English", pl: "Polski" };
