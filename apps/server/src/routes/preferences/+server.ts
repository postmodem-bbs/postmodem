// SPDX-License-Identifier: AGPL-3.0-or-later
// Plain form POST, so switching theme/language works without JavaScript.
import { SUPPORTED } from "@postmodem/i18n";
import { redirect } from "@sveltejs/kit";
import { LANG_COOKIE, parseTheme, safeReturnPath, THEME_COOKIE } from "#lib/server/preferences.ts";
import type { RequestHandler } from "./$types";

const YEAR = 60 * 60 * 24 * 365;

export const POST: RequestHandler = async ({ request, cookies }) => {
  const form = await request.formData();
  const opts = { path: "/", httpOnly: true, sameSite: "lax" as const, maxAge: YEAR };
  cookies.set(THEME_COOKIE, parseTheme(String(form.get("theme"))), opts);
  const lang = String(form.get("lang"));
  if ((SUPPORTED as readonly string[]).includes(lang)) cookies.set(LANG_COOKIE, lang, opts);
  redirect(303, safeReturnPath(String(form.get("returnTo") ?? "/")));
};
