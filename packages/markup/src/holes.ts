// SPDX-License-Identifier: AGPL-3.0-or-later
// Reader-dependent parts of a cached post (EXTENSION-POINTS §7). The cached HTML is the same
// for everyone; these markers are replaced per request, after the cache.
import { escapeHtml } from "./entities.ts";

export interface HoleContext {
  /** Display name of the reader, or null for guests. */
  viewerName: string | null;
  /** Localised strings for the placeholders. */
  messages: { guest: string; hiddenContent: string };
}

export function resolveHoles(html: string, ctx: HoleContext): string {
  if (!html.includes("<!--pm-hole:")) return html;
  return html.replace(/<!--pm-hole:([a-z-]+)-->/g, (_m, kind: string) => {
    switch (kind) {
      case "you":
        return `<span class="bb-you">${escapeHtml(ctx.viewerName ?? ctx.messages.guest)}</span>`;
      case "hide":
        return `<p class="bb-hidden">${escapeHtml(ctx.messages.hiddenContent)}</p>`;
      default:
        return ""; // unknown holes (e.g. from an uninstalled module) render as nothing
    }
  });
}
