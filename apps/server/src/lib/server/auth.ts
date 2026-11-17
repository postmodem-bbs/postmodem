// SPDX-License-Identifier: AGPL-3.0-or-later
// Session cookie handling for the web layer (M1 slice 4). The cookie holds an opaque random
// token; the database keeps only its hash (core `startSession`).
import { type Config, SESSION_IDLE_MS } from "@postmodem/core";
import type { Cookies } from "@sveltejs/kit";

/** `__Host-` (Secure, path=/, no Domain) whenever the board is served over HTTPS. */
export const sessionCookieName = (config: Config) =>
  config.publicUrl.startsWith("https:") ? "__Host-pm_session" : "pm_session";

export function setSessionCookie(cookies: Cookies, config: Config, token: string) {
  cookies.set(sessionCookieName(config), token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicUrl.startsWith("https:"),
    maxAge: Math.floor(SESSION_IDLE_MS / 1000),
  });
}

export function clearSessionCookie(cookies: Cookies, config: Config) {
  cookies.delete(sessionCookieName(config), { path: "/", secure: config.publicUrl.startsWith("https:") });
}
