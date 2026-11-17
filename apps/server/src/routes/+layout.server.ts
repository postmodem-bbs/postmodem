// SPDX-License-Identifier: AGPL-3.0-or-later
import { boardName } from "@postmodem/core";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ locals, url }) => {
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
  };
};
