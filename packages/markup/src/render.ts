// SPDX-License-Identifier: AGPL-3.0-or-later
// AST → HTML. Safe by construction: only the elements and attributes below are ever emitted,
// all text is escaped, and URLs are restricted to http(s)/ftp (and mailto for [email]).
// No inline styles: colours, sizes and effects are classes the theme styles (the CSP forbids
// style attributes, and themes can adjust colours for dark mode and contrast).
import { type Node, parse } from "./bbcode.ts";
import { escapeHtml } from "./entities.ts";

/** Bump whenever output changes, so cached posts.rendered is refreshed. */
export const RENDER_VERSION = 3;

export interface Smiley {
  code: string;
  image: string;
  emotion: string;
}
export interface RenderOptions {
  smilies?: Smiley[];
  /** Capture sanitized reader-dependent content without adding it to the public HTML. */
  captureHole?: (tag: string, render: () => string) => string | undefined;
  /** Base URL path where smiley images are served. */
  smileyBase?: string;
}

/** phpBB2's colour dropdown, as theme classes. Hex values snap to the nearest. */
export const PALETTE: Record<string, [number, number, number]> = {
  darkred: [139, 0, 0],
  red: [255, 0, 0],
  orange: [255, 165, 0],
  brown: [165, 42, 42],
  yellow: [255, 255, 0],
  green: [0, 128, 0],
  olive: [128, 128, 0],
  cyan: [0, 255, 255],
  blue: [0, 0, 255],
  darkblue: [0, 0, 139],
  indigo: [75, 0, 130],
  violet: [238, 130, 238],
  white: [255, 255, 255],
  black: [0, 0, 0],
  gray: [128, 128, 128],
};

export function colorClass(arg: string | null): string | null {
  if (!arg) return null;
  const a = arg.trim().toLowerCase();
  if (Object.hasOwn(PALETTE, a)) return a;
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/.exec(a);
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  const rgb = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  let best = "black";
  let bestD = Number.POSITIVE_INFINITY;
  for (const [name, p] of Object.entries(PALETTE)) {
    const d = (p[0] - rgb[0]!) ** 2 + (p[1] - rgb[1]!) ** 2 + (p[2] - rgb[2]!) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/** phpBB2 sizes were pixel numbers (7–24); map them to five steps. */
export function sizeClass(arg: string | null): string | null {
  const n = Number(arg);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n <= 7 ? "xs" : n <= 10 ? "s" : n <= 13 ? "m" : n <= 19 ? "l" : "xl";
}

/** Normalise a link target, or null if it isn't a safe web link. */
export function safeUrl(raw: string): string | null {
  // Drop whitespace and control characters (they can hide a "javascript:" scheme).
  let url = [...raw.trim()].filter((c) => c > " " && c !== "\u007f").join("");
  if (/^www\./i.test(url)) url = `http://${url}`;
  if (!/^(https?|ftp):\/\/[^\s/?#]+/i.test(url)) return null;
  try {
    const u = new URL(url);
    return ["http:", "https:", "ftp:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

const EMAIL_RE = /^[^\s@<>"']{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,24}$/i;

/** phpBB2 shortened long link labels: first 39 characters … last 10. */
const shortLabel = (url: string) => (url.length > 55 ? `${url.slice(0, 39)}…${url.slice(-10)}` : url);

const AUTOLINK_RE =
  /\b((?:https?|ftp):\/\/[^\s<>"]+|www\.[a-z0-9-]+\.[^\s<>"]+|[^\s@<>"'()[\]]+@[a-z0-9.-]+\.[a-z]{2,24})/gi;

function linkAttrs(href: string) {
  return `href="${escapeHtml(href)}" rel="ugc nofollow noopener"`;
}

function smileyRegex(smilies: Smiley[]): RegExp | null {
  if (!smilies.length) return null;
  const codes = [...smilies]
    .sort((a, b) => b.code.length - a.code.length)
    .map((s) => s.code.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"));
  // Like phpBB2: a smiley must not touch letters or digits on either side.
  return new RegExp(`(?<![\\p{L}\\p{N}])(${codes.join("|")})(?![\\p{L}\\p{N}])`, "gu");
}

const BLOCKS = new Set(["quote", "code", "list", "center", "scroll", "hide"]);
const isBlock = (n: Node | undefined) => n?.type === "tag" && BLOCKS.has(n.name);

/** Drop whitespace-only line breaks at the start and end of a run of nodes (list items). */
function trimEdges(nodes: Node[]): Node[] {
  const out = [...nodes];
  const first = out[0];
  if (first?.type === "text") out[0] = { type: "text", value: first.value.replace(/^\s+/, "") };
  const lastIdx = out.length - 1;
  const last = out[lastIdx];
  if (last?.type === "text") out[lastIdx] = { type: "text", value: last.value.replace(/\s+$/, "") };
  return out;
}

export function renderHtml(source: string, opts: RenderOptions = {}): string {
  const smilies = opts.smilies ?? [];
  const byCode = new Map(smilies.map((s) => [s.code, s]));
  const smileRe = smileyRegex(smilies);
  const smileBase = opts.smileyBase ?? "/smilies/";

  const textHtml = (value: string, { links, smileys }: { links: boolean; smileys: boolean }) => {
    // Split on links first so smilies never land inside URLs.
    const parts: string[] = [];
    let last = 0;
    const out = (s: string) => {
      const html =
        smileys && smileRe
          ? s
              .split(smileRe) // the capturing group puts matched codes at odd indexes
              .map((piece, i) => {
                if (i % 2 === 0) return escapeHtml(piece);
                const sm = byCode.get(piece)!;
                return `<img class="smiley" src="${escapeHtml(smileBase + sm.image)}" alt="${escapeHtml(sm.code)}" title="${escapeHtml(sm.emotion)}">`;
              })
              .join("")
          : escapeHtml(s);
      parts.push(html.replace(/\n/g, "<br>"));
    };
    if (links) {
      for (const m of value.matchAll(AUTOLINK_RE)) {
        let target = m[1]!;
        // Trailing punctuation belongs to the sentence, not the link.
        const trail = /[.,;:!?)\]]+$/.exec(target)?.[0] ?? "";
        target = target.slice(0, target.length - trail.length);
        const isEmail = target.includes("@") && !target.includes("/");
        const href = isEmail ? (EMAIL_RE.test(target) ? `mailto:${target}` : null) : safeUrl(target);
        out(value.slice(last, m.index));
        if (href)
          parts.push(`<a ${linkAttrs(href)}>${escapeHtml(isEmail ? target : shortLabel(target))}</a>`);
        else out(target);
        last = m.index! + target.length;
      }
    }
    out(value.slice(last));
    return parts.join("");
  };

  const plain = (nodes: Node[]): string =>
    nodes.map((n) => (n.type === "text" ? n.value : n.name === "hide" ? "" : plain(n.children))).join("");

  // Line breaks typed next to a block (quote, code, list…) would add <br>s on top of the
  // block's own margins; up to two are absorbed on each side.
  const render = (nodes: Node[], ctx: { links: boolean; smileys: boolean }): string =>
    nodes
      .map((n, i) => {
        if (n.type !== "text") return tag(n, ctx);
        let value = n.value;
        if (isBlock(nodes[i - 1])) value = value.replace(/^\n{1,2}/, "");
        if (isBlock(nodes[i + 1])) value = value.replace(/\n{1,2}$/, "");
        return textHtml(value, ctx);
      })
      .join("");

  const tag = (n: Extract<Node, { type: "tag" }>, ctx: { links: boolean; smileys: boolean }): string => {
    const inner = () => render(n.children, ctx);
    switch (n.name) {
      case "b":
        return `<strong>${inner()}</strong>`;
      case "i":
        return `<em>${inner()}</em>`;
      case "u":
        return `<u>${inner()}</u>`;
      case "color": {
        const c = colorClass(n.arg);
        return c ? `<span class="bb-color bb-color-${c}">${inner()}</span>` : inner();
      }
      case "size": {
        const s = sizeClass(n.arg);
        return s ? `<span class="bb-size-${s}">${inner()}</span>` : inner();
      }
      case "url": {
        const href = safeUrl(n.arg ?? plain(n.children));
        if (!href) return inner();
        const label = n.arg
          ? render(n.children, { ...ctx, links: false })
          : escapeHtml(shortLabel(plain(n.children)));
        return `<a ${linkAttrs(href)}>${label || escapeHtml(shortLabel(href))}</a>`;
      }
      case "email": {
        const addr = plain(n.children).trim();
        return EMAIL_RE.test(addr)
          ? `<a ${linkAttrs(`mailto:${addr}`)}>${escapeHtml(addr)}</a>`
          : escapeHtml(addr);
      }
      case "img": {
        const src = safeUrl(plain(n.children));
        if (!src || src.startsWith("ftp:")) return escapeHtml(plain(n.children));
        return `<img class="bb-img" src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
      }
      case "code":
        return `<pre class="bb-code"><code>${escapeHtml(plain(n.children).replace(/^\n|\n$/g, ""))}</code></pre>`;
      case "quote": {
        const cite = n.arg ? `<cite class="bb-quote-author">${escapeHtml(n.arg)}</cite>` : "";
        return `<blockquote class="bb-quote">${cite}<div class="bb-quote-body">${inner()}</div></blockquote>`;
      }
      case "list": {
        const items = n.children
          .filter((c) => c.type === "tag" && c.name === "*")
          .map((c) => `<li>${render(trimEdges((c as Extract<Node, { type: "tag" }>).children), ctx)}</li>`)
          .join("");
        const kind = n.arg?.trim();
        if (!kind) return `<ul class="bb-list">${items}</ul>`;
        const type = { "1": "1", a: "a", A: "A", i: "i", I: "I" }[kind] ?? "1";
        return `<ol class="bb-list" type="${type}">${items}</ol>`;
      }
      case "*":
        return inner(); // only reached outside a list, which the parser prevents
      case "center":
        return `<div class="bb-center">${inner()}</div>`;
      case "fade":
        return `<span class="bb-fade">${inner()}</span>`;
      case "glow": {
        const c = colorClass(n.arg);
        return `<span class="bb-glow${c ? ` bb-color-${c}` : ""}">${inner()}</span>`;
      }
      case "shadow": {
        const c = colorClass(n.arg);
        return `<span class="bb-shadow${c ? ` bb-color-${c}` : ""}">${inner()}</span>`;
      }
      case "scroll":
        return `<div class="bb-scroll"><span>${inner()}</span></div>`;
      // Without a registered consumer this private tag remains a placeholder.
      case "hide":
        return opts.captureHole?.(n.name, inner) ?? "<!--pm-hole:hide-->";
      case "you":
        return "<!--pm-hole:you-->";
    }
  };

  return render(parse(source), { links: true, smileys: true });
}
