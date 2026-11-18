// SPDX-License-Identifier: AGPL-3.0-or-later
// /search.php — phpBB2's search (M2 slice 6), with its parameter names:
//   ?search_keywords=…&search_author=…&search_forum=ID&start=N
// Every word must match (as a prefix, diacritics ignored); results are permission-filtered by
// the forums the reader may read, newest first, 25 a page.
import { searchTerms } from "@postmodem/core";
import { excerpt } from "@postmodem/markup";
import { normaliseStart } from "#lib/pagination.ts";
import { nodeRef, topicRef } from "#lib/server/board.ts";
import type { PageServerLoad } from "./$types";

const PER_PAGE = 25;

export const load: PageServerLoad = async ({ url, locals, getClientAddress, setHeaders }) => {
  const { repos } = locals.ctx.db;
  const keywords = (url.searchParams.get("search_keywords") ?? "").slice(0, 200);
  const authorName = (url.searchParams.get("search_author") ?? "").trim().slice(0, 100);
  const forumId = Number(url.searchParams.get("search_forum")) || 0;
  const tree = await repos.nodes.tree();
  const readable = tree.filter((n) => n.kind === "forum" && locals.perms.can("node.read", n));
  const forums = readable.map((n) => ({ id: n.id, title: `${"— ".repeat(n.depth)}${n.title}` }));
  const form = { keywords, author: authorName, forum: forumId };
  const terms = searchTerms(keywords);
  if (!keywords && !authorName) return { form, forums, searched: false as const };
  setHeaders({ "x-robots-tag": "noindex" });
  if (!terms.length)
    return {
      form,
      forums,
      searched: true as const,
      problem: "terms" as const,
      results: [],
      total: 0,
      start: 0,
      perPage: PER_PAGE,
    };

  const now = Date.now();
  const ip = getClientAddress();
  const wait = await locals.ctx.throttles.search.wait(ip, now);
  if (wait > 0)
    return {
      form,
      forums,
      searched: true as const,
      problem: "throttled" as const,
      seconds: Math.ceil(wait / 1000),
      results: [],
      total: 0,
      start: 0,
      perPage: PER_PAGE,
    };
  await locals.ctx.throttles.search.fail(ip, now);

  const author = authorName ? await repos.users.byUsername(authorName) : null;
  if (authorName && !author)
    return {
      form,
      forums,
      searched: true as const,
      problem: "author" as const,
      results: [],
      total: 0,
      start: 0,
      perPage: PER_PAGE,
    };
  // A forum includes its sub-forums.
  const scope = forumId ? readable.filter((n) => n.path.includes(`/${forumId}/`)) : readable;
  const start = normaliseStart(url.searchParams.get("start"), PER_PAGE, Number.MAX_SAFE_INTEGER);
  const page = await repos.search.query({
    terms,
    nodeIds: scope.map((n) => n.id),
    authorId: author?.id,
    page: { page: start / PER_PAGE + 1, perPage: PER_PAGE },
  });
  const posts = await repos.posts.getMany(page.items);
  const topics = await repos.topics.getMany([...posts.values()].map((p) => p.topicId));
  const users = await repos.users.getMany(
    [...posts.values()].flatMap((p) => (p.authorId ? [p.authorId] : [])),
  );
  const nodes = new Map(tree.map((n) => [n.id, n]));
  const results = page.items.flatMap((id) => {
    const p = posts.get(id);
    const t = p && topics.get(p.topicId);
    const n = t && nodes.get(t.nodeId);
    if (!p || !t || !n) return [];
    return [
      {
        postId: p.id,
        topic: { ...topicRef(t), title: t.title },
        forum: { ...nodeRef(n), title: n.title },
        author: (p.authorId && users.get(p.authorId)?.username) || p.authorName,
        at: p.createdAt,
        excerpt: excerpt(p.source, 240),
      },
    ];
  });
  return {
    form,
    forums,
    searched: true as const,
    problem: null,
    results,
    // The index counts to 1001 at most ("more than 1000"); pages stop at 1000.
    total: Math.min(page.total, 1000),
    more: page.total > 1000,
    start,
    perPage: PER_PAGE,
  };
};
