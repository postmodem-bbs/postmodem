// SPDX-License-Identifier: AGPL-3.0-or-later
import { boardName, registrationOpen, urlStyle } from "@postmodem/core";
import { forRequest } from "#lib/server/packages.ts";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const { config, settings } = locals.ctx;
  return {
    locale: locals.locale,
    theme: locals.theme,
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
  };
};
