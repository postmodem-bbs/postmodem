// SPDX-License-Identifier: AGPL-3.0-or-later
// Post rendering with a per-post cache (posts.rendered + render_version) and per-reader holes.
import type { Id, Post, Repositories } from "@postmodem/core";
import { escapeHtml, RENDER_VERSION, renderHtml, resolveHoles, type Smiley } from "@postmodem/markup";

export interface Renderer {
  /** Cached HTML for each post (holes unresolved): renders and stores whatever is stale. */
  render(posts: Post[]): Promise<Map<Id, string>>;
  /** Fill reader-dependent holes. */
  forReader(
    html: string,
    viewerName: string | null,
    messages: { guest: string; hiddenContent: string },
  ): string;
  /** Call after smilies change, so the next render picks them up. */
  invalidateSmilies(): void;
}

export function createRenderer(repos: Repositories): Renderer {
  let smilies: Promise<Smiley[]> | undefined;
  const loadSmilies = () => (smilies ??= repos.smilies.all());

  const toHtml = (post: Post, sm: Smiley[]) => {
    switch (post.format) {
      case "bbcode-phpbb2":
        return renderHtml(post.source, { smilies: sm });
      default:
        // Unknown formats (e.g. from a package that's no longer installed) show as text.
        return escapeHtml(post.source).replace(/\n/g, "<br>");
    }
  };

  return {
    async render(posts) {
      const out = new Map<Id, string>();
      const stale = posts.filter((p) => p.renderVersion !== RENDER_VERSION || p.rendered === null);
      const sm = stale.length ? await loadSmilies() : [];
      for (const post of posts) {
        if (post.renderVersion === RENDER_VERSION && post.rendered !== null) {
          out.set(post.id, post.rendered);
          continue;
        }
        const html = toHtml(post, sm);
        out.set(post.id, html);
        await repos.posts.setRendered(post.id, html, RENDER_VERSION);
      }
      return out;
    },
    forReader: (html, viewerName, messages) => resolveHoles(html, { viewerName, messages }),
    invalidateSmilies() {
      smilies = undefined;
    },
  };
}
