// SPDX-License-Identifier: AGPL-3.0-or-later
// Plain form POST, so switching colour scheme and language works without JavaScript. Members'
// choices are saved with their account; guests' go into the preferences cookie.
import { redirect } from "@sveltejs/kit";
import { colorScheme, language, readerTheme } from "#lib/server/platform.ts";
import { choose, safeReturnPath } from "#lib/server/preferences.ts";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
  const form = await request.formData();
  await choose(locals, cookies, [
    [readerTheme, form.get("boardTheme")],
    [colorScheme, form.get("theme")],
    [language, String(form.get("lang"))],
  ]);
  redirect(303, safeReturnPath(String(form.get("returnTo") ?? "/")));
};
