// SPDX-License-Identifier: AGPL-3.0-or-later
import { boardName, registrationOpen, urlStyle } from "@postmodem/core";
import { forRequest } from "#lib/server/packages.ts";
import { readerTheme } from "#lib/server/platform.ts";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals, url, depends }) => {
  // Live updates (lib/live.ts) reload only this: the header's counts.
  depends("pm:header");
  const { config, settings } = locals.ctx;
  return {
    locale: locals.locale,
    theme: locals.prefs.get(readerTheme),
    colorScheme: locals.colorScheme,
    boardName: settings.get(boardName),
    version: config.version,
    // ADR 0010: every page links to the exact source of what is running.
    sourceUrl:
      config.sourceUrl ??
      `https://github.com/postmodem-bbs/postmodem/tree/${config.revision === "unknown" ? "main" : config.revision}`,
    returnTo: url.pathname + url.search,
    user: locals.user ? { id: locals.user.id, username: locals.user.username } : null,
    registrationOpen: settings.get(registrationOpen),
    urlStyle: settings.get(urlStyle),
    // Packages' header links (e.g. the reports queue with its count).
    headerBadges: locals.user ? await forRequest(locals).slot("header.badges") : [],
    isAdmin: !!locals.user && locals.perms.can("admin.access", null),
    unreadMessages: locals.user ? await locals.ctx.db.repos.messages.unreadCount(locals.user.id) : 0,
  };
};
