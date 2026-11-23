// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  boardDateFormat,
  boardTimeZone,
  defaultLocale,
  defaultTheme,
  endSession,
  findBan,
  isTimeZone,
  resolveSession,
  urlStyle,
} from "@postmodem/core";
import { negotiate, translator } from "@postmodem/i18n";
import type { Handle } from "@sveltejs/kit/hooks";
import { clearSessionCookie, sessionCookieName } from "#lib/server/auth.ts";
import { getContext } from "#lib/server/bootstrap.ts";
import { urlsFor } from "#lib/server/links.ts";
import { colorScheme, dateFormat, language, readerTheme } from "#lib/server/platform.ts";
import { choose, guestPreferenceCookie } from "#lib/server/preferences.ts";

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

  event.locals.ctx = ctx;
  event.locals.urls = urlsFor(ctx.settings.get(urlStyle));
  // Language: the reader's choice → Accept-Language → board default.
  const pickLocale = (chosen: string) =>
    negotiate({
      requested: chosen === "auto" ? undefined : chosen,
      acceptLanguage: event.request.headers.get("accept-language"),
      boardDefault: ctx.settings.get(defaultLocale),
    });
  const guestPrefs = await ctx.platform.preferences.forReader(null, guestPreferenceCookie(event.cookies));
  event.locals.locale = pickLocale(guestPrefs.get(language));

  // Bans (phpBB2's banlist): a banned IP gets nothing but this page; a banned member's
  // session ends and they browse as a guest (signing in again is refused).
  const bans = await ctx.activeBans();
  const ip = event.getClientAddress();
  const ipBan = findBan(
    bans.filter((b) => b.kind === "ip"),
    { ip },
  );
  if (ipBan) return bannedPage(event.locals.locale, ipBan.reason);

  // Session: an opaque cookie whose hash names a server-side session (core accounts.ts).
  const cookieName = sessionCookieName(ctx.config);
  const token = event.cookies.get(cookieName);
  const auth = token
    ? await resolveSession(ctx.db.repos, token, Date.now(), (session) =>
        ctx.packages.validateSession(session, ip),
      )
    : null;
  if (token && !auth) clearSessionCookie(event.cookies, ctx.config);
  if (auth && token && findBan(bans, { userId: auth.user.id, email: auth.user.email })) {
    await endSession(ctx.db.repos, token);
    clearSessionCookie(event.cookies, ctx.config);
    event.locals.user = null;
    event.locals.session = null;
    event.locals.perms = await ctx.permissions(null);
  } else {
    event.locals.user = auth?.user ?? null;
    event.locals.session = auth?.session ?? null;
    event.locals.perms = await ctx.permissions(auth?.user.id ?? null);
  }

  // Preferences (members': stored with the account). ?lang= switches and remembers.
  const requested = event.url.searchParams.get("lang");
  event.locals.prefs = requested
    ? await choose(event.locals, event.cookies, [[language, requested]])
    : event.locals.user
      ? await ctx.platform.preferences.forReader(event.locals.user.id, guestPreferenceCookie(event.cookies))
      : guestPrefs;
  event.locals.locale = pickLocale(requested ?? event.locals.prefs.get(language));
  const theme = event.locals.prefs.get(readerTheme);
  event.locals.themeId = theme === "board" ? ctx.settings.get(defaultTheme) : theme;
  event.locals.colorScheme = event.locals.prefs.get(colorScheme);
  const style = event.locals.prefs.get(dateFormat);
  const zone = event.locals.user?.timezone;
  event.locals.dates = {
    locale: event.locals.locale,
    timeZone: isTimeZone(zone) ? zone : ctx.settings.get(boardTimeZone),
    style: style === "board" ? ctx.settings.get(boardDateFormat) : style,
  };
  // E-mails go out in the language the member last saw the board in (users.locale), so a
  // change made in the footer or on /account reaches them too.
  if (event.locals.user && event.locals.user.locale !== event.locals.locale)
    await ctx.db.repos.users.update(event.locals.user.id, { locale: event.locals.locale });
  event.locals.requestContext = {
    via: "web",
    ip,
    userAgent: event.request.headers.get("user-agent")?.slice(0, 300),
    sessionId: event.locals.session?.id,
    locale: event.locals.locale,
    timezone: event.locals.user?.timezone ?? null,
  };
  const response = await resolve(event, {
    transformPageChunk: ({ html }) =>
      html
        .replace("%pm.lang%", event.locals.locale)
        .replaceAll("%pm.themeId%", event.locals.themeId)
        .replace("%pm.colorScheme%", event.locals.colorScheme === "system" ? "" : event.locals.colorScheme),
  });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
  // Pages rendered for a signed-in user must never land in a shared cache.
  if (event.locals.user && !response.headers.has("cache-control"))
    response.headers.set("cache-control", "private, no-cache");
  if (response.headers.get("content-type")?.startsWith("text/html")) {
    response.headers.append("vary", "Cookie");
  }
  return response;
};

/** A minimal page, outside the app: banned visitors get no board at all (phpBB2 did the same). */
function bannedPage(locale: App.Locals["locale"], reason: string): Response {
  const t = translator(locale);
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const body = `<!doctype html><html lang="${esc(locale)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(t("banned-title"))}</title><h1>${esc(t("banned-title"))}</h1>${reason ? `<p>${esc(t("banned-reason"))} ${esc(reason)}</p>` : ""}`;
  return new Response(body, {
    status: 403,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS },
  });
}
