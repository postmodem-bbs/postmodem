// SPDX-License-Identifier: AGPL-3.0-or-later
// Guest/member display preferences that matter before login exists (theme, language).
// Stored in cookies for now; the preferences service (PLATFORM-SERVICES §4) replaces this.
export const THEME_COOKIE = "pm_theme";
export const LANG_COOKIE = "pm_lang";
export const THEME_CHOICES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export const parseTheme = (v: string | null | undefined): ThemeChoice =>
  (THEME_CHOICES as readonly string[]).includes(v ?? "") ? (v as ThemeChoice) : "system";

/** Only same-origin relative paths are allowed as redirect targets. */
export function safeReturnPath(v: string | null | undefined): string {
  if (!v?.startsWith("/") || v.startsWith("//") || v.includes("\\")) return "/";
  return v;
}
