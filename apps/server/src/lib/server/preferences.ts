// SPDX-License-Identifier: AGPL-3.0-or-later
// Readers' preferences on the platform service (M2b slice 10): members' choices are stored
// with their account, guests' in one cookie. The colour scheme and language are the first.
import { PREFERENCE_COOKIE, type PreferenceDef, type PreferenceView } from "@postmodem/core";
import type { Cookies } from "@sveltejs/kit";

/** Cookies from 0.1.0, read until a guest's next choice replaces them. */
const LEGACY_THEME_COOKIE = "pm_theme";
const LEGACY_LANG_COOKIE = "pm_lang";

const YEAR = 60 * 60 * 24 * 365;

/** The guest cookie, or one built from 0.1.0's separate cookies. */
export function guestPreferenceCookie(cookies: Pick<Cookies, "get">): string | undefined {
  const current = cookies.get(PREFERENCE_COOKIE);
  if (current) return current;
  const theme = cookies.get(LEGACY_THEME_COOKIE);
  const lang = cookies.get(LEGACY_LANG_COOKIE);
  if (!theme && !lang) return undefined;
  return JSON.stringify({
    ...(theme ? { "core.colorScheme": theme } : {}),
    ...(lang ? { "core.language": lang } : {}),
  });
}

/**
 * Saves a reader's choice: on their account, or in the guest cookie. Returns the reader's
 * preferences as they are now. Invalid values are ignored (forms can send anything).
 */
export async function choose(
  locals: Pick<App.Locals, "ctx" | "user">,
  cookies: Cookies,
  choices: [PreferenceDef<unknown>, unknown][],
): Promise<PreferenceView> {
  const { preferences } = locals.ctx.platform;
  const userId = locals.user?.id ?? null;
  let cookie = guestPreferenceCookie(cookies);
  for (const [def, value] of choices) {
    try {
      const r = await preferences.set(userId, def.key, value, cookie);
      if (r.cookie !== null) cookie = r.cookie;
    } catch {
      // not a valid value for this preference: keep the old one
    }
  }
  if (userId === null && cookie !== undefined) {
    cookies.set(PREFERENCE_COOKIE, cookie, { path: "/", httpOnly: true, sameSite: "lax", maxAge: YEAR });
    for (const old of [LEGACY_THEME_COOKIE, LEGACY_LANG_COOKIE])
      if (cookies.get(old)) cookies.delete(old, { path: "/" });
  }
  return preferences.forReader(userId, cookie);
}

/** Only same-origin relative paths are allowed as redirect targets. */
export function safeReturnPath(v: string | null | undefined): string {
  if (!v?.startsWith("/") || v.startsWith("//") || v.includes("\\")) return "/";
  return v;
}
