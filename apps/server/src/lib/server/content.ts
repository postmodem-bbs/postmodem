// SPDX-License-Identifier: AGPL-3.0-or-later
// Post rendering with a per-post cache (posts.rendered + render_version) and per-reader holes.
import type { Id, Post, Repositories } from "@postmodem/core";
import { escapeHtml, RENDER_VERSION, renderHtml, resolveHoles, type Smiley } from "@postmodem/markup";

export interface Renderer {
  /** Render stale posts, then include only the private fragments this reader may see. */
  render(
    posts: Post[],
    visibleHoles?: (keys: ReadonlySet<string>) => Promise<ReadonlySet<string>>,
  ): Promise<Map<Id, string>>;
  /** Fill reader-dependent holes. */
  forReader(
    html: string,
    viewerName: string | null,
    messages: { guest: string; hiddenContent: string },
  ): string;
  /**
   * HTML for text that isn't cached (posting preview, private messages), with the reader's
   * holes filled: [you] is the reader; [hide] stays hidden (it's about topic replies).
   */
  preview(
    source: string,
    reader?: { name: string | null; messages: { guest: string; hiddenContent: string } },
  ): Promise<string>;
  /** Call after smilies change, so the next render picks them up. */
  invalidateSmilies(): void;
}

interface Fragment {
  key: string;
  html: string;
}

interface CachedPost {
  html: string;
  fragments: Fragment[];
}

const cacheMarker = "<!--pm-render-cache-->";
const fragmentMarker = /<!--pm-render-fragment:(\d+)-->/g;

export function createRenderer(repos: Repositories, tags: ReadonlyMap<string, string> = new Map()): Renderer {
  let smilies: Promise<Smiley[]> | undefined;
  const loadSmilies = () => (smilies ??= repos.smilies.all());
  const prefix = tags.size ? `${cacheMarker}${JSON.stringify([...tags].sort())}\n` : "";

  const prepare = (post: Post, sm: Smiley[]): CachedPost => {
    const fragments: Fragment[] = [];
    const html =
      post.format === "bbcode-phpbb2"
        ? renderHtml(post.source, {
            smilies: sm,
            captureHole(tag, render) {
              const key = tags.get(tag);
              if (!key) return;
              const html = render();
              const index = fragments.push({ key, html }) - 1;
              return `<!--pm-render-fragment:${index}-->`;
            },
          })
        : escapeHtml(post.source).replace(/\n/g, "<br>");
    return { html, fragments };
  };

  const readCache = (post: Post): CachedPost | undefined => {
    const cached = post.rendered;
    if (post.renderVersion !== RENDER_VERSION || cached === null) return;
    if (!prefix) {
      if (!cached.startsWith(cacheMarker)) return { html: cached, fragments: [] };
      return;
    }
    if (!cached.startsWith(prefix)) return;
    try {
      const parsed: CachedPost = JSON.parse(cached.slice(prefix.length));
      if (typeof parsed.html === "string" && Array.isArray(parsed.fragments)) return parsed;
    } catch {
      // A stale or unreadable cache can always be rebuilt from the post.
    }
  };

  return {
    async render(posts, visibleHoles) {
      const prepared = new Map<Id, CachedPost>();
      const keys = new Set<string>();
      for (const post of posts) {
        let entry = readCache(post);
        if (!entry) {
          entry = prepare(post, await loadSmilies());
          const stored = prefix ? prefix + JSON.stringify(entry) : entry.html;
          await repos.posts.setRendered(post.id, stored, RENDER_VERSION, post.source);
        }
        for (const fragment of entry.fragments) keys.add(fragment.key);
        prepared.set(post.id, entry);
      }
      const visible = visibleHoles && keys.size ? await visibleHoles(keys) : new Set<string>();
      return new Map(
        [...prepared].map(([id, { html, fragments }]) => {
          // Children are captured before their parent, so only earlier indices may be nested.
          const fill = (text: string, before: number): string =>
            text.replace(fragmentMarker, (_marker, index: string) => {
              const n = Number(index);
              const fragment = n < before ? fragments[n] : undefined;
              return fragment && visible.has(fragment.key) ? fill(fragment.html, n) : "<!--pm-hole:hide-->";
            });
          return [id, fill(html, fragments.length)];
        }),
      );
    },
    forReader: (html, viewerName, messages) => resolveHoles(html, { viewerName, messages }),
    preview: async (source, reader) => {
      const html = renderHtml(source, { smilies: await loadSmilies() });
      return reader ? resolveHoles(html, { viewerName: reader.name, messages: reader.messages }) : html;
    },
    invalidateSmilies() {
      smilies = undefined;
    },
  };
}
