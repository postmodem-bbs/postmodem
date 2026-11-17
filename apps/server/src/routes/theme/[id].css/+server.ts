// SPDX-License-Identifier: AGPL-3.0-or-later
// Theme CSS generated from design tokens (DESIGN.md §7, layer 1).
import { THEMES, themeCss } from "@postmodem/ui";
import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const cache = new Map<string, string>();

export const GET: RequestHandler = ({ params }) => {
  const theme = THEMES[params.id];
  if (!theme) error(404, "unknown theme");
  let css = cache.get(theme.id);
  if (!css) {
    css = themeCss(theme);
    cache.set(theme.id, css);
  }
  return new Response(css, {
    headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
};
