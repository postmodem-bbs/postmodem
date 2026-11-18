// SPDX-License-Identifier: AGPL-3.0-or-later
// The urls service (ADR 0012): every link is built here, in the board's URL style, and every
// public URL shape of every style is mapped here onto the internal id-based routes.
//
//   style     category              forum                 topic                     user
//   classic   /index.php?c=3        /viewforum.php?f=7    /viewtopic.php?t=123      /profile.php?mode=viewprofile&u=42
//   numbered  /c/3-general          /f/7-hardware         /t/123-my-pc              /u/42-alucard
//   slug      /category/general     /forum/hardware       /topic/my-pc              /user/alucard
//
// Posts: /viewtopic.php?p=4567 (classic) or /p/4567, both sent on to the right topic page.
// Pagination: classic counts items (`start=30`), the others pages (`page=3`); both are read
// everywhere, and pages redirect to their canonical form (see lib/server/canonical.ts).
// Pure: used by Svelte components, the server, and the universal `reroute` hook.
import type { NodeKind, UrlStyle } from "@postmodem/core";
import { POSTS_PER_PAGE, TOPICS_PER_PAGE } from "./pagination.ts";

type Id = number;

export interface NodeRef {
  id: Id;
  slug: string;
  kind: NodeKind;
  /**
   * Categories only: the number classic `index.php?c=` uses. Imported categories keep their
   * phpBB2 number; null when it would be ambiguous (the classic link then falls back to /c/).
   */
  classicId?: Id | null;
}
export interface TopicRef {
  id: Id;
  slug: string;
}
export interface UserRef {
  id: Id;
  slug: string;
}

/** The internal routes the public shapes map onto (src/routes/-/…). */
export const INTERNAL = "/-";

/** Imported topic slugs end in their id (`my-pc-123`); the numbered style already shows it. */
const bare = (slug: string, id: Id) => (slug.endsWith(`-${id}`) ? slug.slice(0, -`-${id}`.length) : slug);
const numbered = (prefix: string, id: Id, slug: string) => {
  const s = bare(slug, id);
  return `/${prefix}/${id}${s ? `-${s}` : ""}`;
};

export interface Urls {
  style: UrlStyle;
  index(): string;
  category(node: NodeRef): string;
  /** A forum or category, whichever the node is. */
  node(node: NodeRef, start?: number): string;
  forum(node: NodeRef, start?: number): string;
  topic(topic: TopicRef, start?: number): string;
  /** A post wherever it is: resolved to the right topic page by the server. */
  post(postId: Id): string;
  /** A post on a known page of its topic (no extra redirect). */
  postOnPage(topic: TopicRef, start: number, postId: Id): string;
  user(user: UserRef): string;
  /** phpBB2's posting.php, the same in every style. */
  posting: {
    newTopic(forumId: Id): string;
    reply(topicId: Id): string;
    quote(postId: Id): string;
    edit(postId: Id): string;
    delete(postId: Id): string;
  };
}

const POSTING = {
  newTopic: (f: Id) => `/posting.php?mode=newtopic&f=${f}`,
  reply: (t: Id) => `/posting.php?mode=reply&t=${t}`,
  quote: (p: Id) => `/posting.php?mode=quote&p=${p}`,
  edit: (p: Id) => `/posting.php?mode=editpost&p=${p}`,
  delete: (p: Id) => `/posting.php?mode=delete&p=${p}`,
};

export function makeUrls(style: UrlStyle): Urls {
  const classic = style === "classic";
  const paged = (base: string, start: number | undefined, perPage: number) => {
    if (!start || start <= 0) return base;
    const sep = base.includes("?") ? "&" : "?";
    return classic ? `${base}${sep}start=${start}` : `${base}${sep}page=${Math.floor(start / perPage) + 1}`;
  };
  const category = (n: NodeRef) => {
    if (classic) return n.classicId ? `/index.php?c=${n.classicId}` : numbered("c", n.id, n.slug);
    return style === "numbered" ? numbered("c", n.id, n.slug) : `/category/${n.slug}`;
  };
  const forum = (n: NodeRef, start?: number) => {
    const base = classic
      ? `/viewforum.php?f=${n.id}`
      : style === "numbered"
        ? numbered("f", n.id, n.slug)
        : `/forum/${n.slug}`;
    return paged(base, start, TOPICS_PER_PAGE);
  };
  const topic = (t: TopicRef, start?: number) => {
    const base = classic
      ? `/viewtopic.php?t=${t.id}`
      : style === "numbered"
        ? numbered("t", t.id, t.slug)
        : `/topic/${t.slug}`;
    return paged(base, start, POSTS_PER_PAGE);
  };
  return {
    style,
    index: () => "/",
    category,
    node: (n, start) => (n.kind === "category" ? category(n) : forum(n, start)),
    forum,
    topic,
    post: (id) => (classic ? `/viewtopic.php?p=${id}#p${id}` : `/p/${id}`),
    postOnPage: (t, start, id) => `${topic(t, start)}#p${id}`,
    posting: POSTING,
    user: (u) =>
      classic
        ? `/profile.php?mode=viewprofile&u=${u.id}`
        : style === "numbered"
          ? numbered("u", u.id, u.slug)
          : `/user/${u.slug}`,
  };
}

/** Requested page as an item offset, from `start=` (classic) or `page=` (the other styles). */
export function requestedStart(params: URLSearchParams, perPage: number): number {
  const page = Number(params.get("page"));
  if (Number.isInteger(page) && page > 1) return (page - 1) * perPage;
  const start = Number(params.get("start"));
  return Number.isFinite(start) && start > 0 ? Math.floor(start) : 0;
}

const POSITIVE = /^[1-9][0-9]{0,15}$/;
const id = (v: string | null) => (v !== null && POSITIVE.test(v) ? v : null);
// Path segments the numbered style accepts: "123" or "123-anything".
const NUMBERED = /^\/(c|f|t|u|p)\/([1-9][0-9]{0,15})(?:-[^/]*)?\/?$/;
const SLUGGED = /^\/(category|forum|topic|user)\/([a-z0-9][a-z0-9-]{0,199})\/?$/;
const KINDS = { c: "category", f: "forum", t: "topic", u: "user", p: "post" } as const;

/**
 * Maps a public URL onto the internal route that serves it, or undefined to leave it alone.
 * Route refs: `123` (id), `~my-slug` (slug), `@3` (classic `index.php?c=` number).
 */
export function internalPath(url: URL): string | undefined {
  const path = url.pathname;
  const q = url.searchParams;
  switch (path) {
    case "/viewtopic.php": {
      const t = id(q.get("t"));
      if (t) return `${INTERNAL}/topic/${t}`;
      const p = id(q.get("p"));
      return p ? `${INTERNAL}/post/${p}` : undefined;
    }
    case "/viewforum.php": {
      const f = id(q.get("f"));
      return f ? `${INTERNAL}/forum/${f}` : undefined;
    }
    case "/index.php": {
      const c = id(q.get("c"));
      return c ? `${INTERNAL}/category/@${c}` : "/";
    }
    case "/profile.php": {
      const u = id(q.get("u"));
      return q.get("mode") === "viewprofile" && u ? `${INTERNAL}/user/${u}` : undefined;
    }
  }
  const n = NUMBERED.exec(path);
  if (n) return `${INTERNAL}/${KINDS[n[1] as keyof typeof KINDS]}/${n[2]}`;
  const s = SLUGGED.exec(path);
  if (s) return `${INTERNAL}/${s[1]}/~${s[2]}`;
  return undefined;
}

export type Ref = { id: Id } | { slug: string } | { classicId: Id };

/** Parses an internal route ref (see internalPath). */
export function parseRef(ref: string): Ref | null {
  if (ref.startsWith("~")) {
    const slug = ref.slice(1);
    return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? { slug } : null;
  }
  if (ref.startsWith("@")) return POSITIVE.test(ref.slice(1)) ? { classicId: Number(ref.slice(1)) } : null;
  return POSITIVE.test(ref) ? { id: Number(ref) } : null;
}
