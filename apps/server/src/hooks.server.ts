// SPDX-License-Identifier: AGPL-3.0-or-later
import { defaultLocale } from "@postmodem/core";
import { negotiate } from "@postmodem/i18n";
import type { Handle } from "@sveltejs/kit/hooks";
import { getContext } from "#lib/server/bootstrap.ts";
import { LANG_COOKIE, parseTheme, THEME_COOKIE } from "#lib/server/preferences.ts";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "cross-origin-opener-policy": "same-origin",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const handle: Handle = async ({ event, resolve }) => {
  const ctx = await getContext();
  const path = event.url.pathname;

  // Health endpoints (CONTAINERS.md §2.1): cheap, no locale, no session.
  if (path === "/healthz") return json(200, { status: "ok" });
  if (path === "/readyz") {
    const r = await ctx.readiness();
    return json(
      r.ready ? 200 : 503,
      r.ready ? { status: "ready" } : { status: "not-ready", reason: r.reason },
    );
  }

  // Language: ?lang= switches and remembers; otherwise cookie → Accept-Language → board default.
  const requested = event.url.searchParams.get("lang");
  if (requested) {
    event.cookies.set(LANG_COOKIE, requested, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 31536000,
    });
  }
  event.locals.ctx = ctx;
  event.locals.locale = negotiate({
    requested: requested ?? event.cookies.get(LANG_COOKIE),
    acceptLanguage: event.request.headers.get("accept-language"),
    boardDefault: ctx.settings.get(defaultLocale),
  });
  event.locals.theme = parseTheme(event.cookies.get(THEME_COOKIE));
  // Accounts arrive in slice 4; until then everyone is a guest.
  event.locals.perms = await ctx.permissions(null);

  const response = await resolve(event, {
    transformPageChunk: ({ html }) =>
      html
        .replace("%pm.lang%", event.locals.locale)
        .replace("%pm.theme%", event.locals.theme === "system" ? "" : event.locals.theme),
  });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
  return response;
};
