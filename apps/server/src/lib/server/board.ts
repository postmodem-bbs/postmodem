// SPDX-License-Identifier: AGPL-3.0-or-later
// Read models for the board pages. Every lookup is batched (getMany), never per row.
// Permission-aware (ADR 0015): forums without node.view are invisible (and 404), forums with
// node.view but not node.read are listed but closed (403), and nothing from an unreadable
// forum (last-post titles, counts) leaks through a readable one.
import type { Id, Node, Permissions, Post, Repositories, Topic } from "@postmodem/core";
import { normaliseStart } from "../pagination.ts";

export const TOPICS_PER_PAGE = 25;
export const POSTS_PER_PAGE = 15;

export interface LastPost {
  postId: Id;
  topicId: Id;
  topicTitle: string;
  at: number;
  author: string; // "" = guest without a name
}
export interface ForumRow {
  id: Id;
  title: string;
  description: string;
  locked: boolean;
  /** Listed (node.view) but not readable (node.read): counts shown, last post withheld. */
  restricted: boolean;
  topicCount: number;
  postCount: number;
  subforums: { id: Id; title: string }[];
  lastPost: LastPost | null;
}
export interface Crumb {
  id: Id;
  title: string;
  kind: Node["kind"];
}

/** 404 when the viewer may not even know the forum exists, 403 when they may see but not read it. */
export type Access = "ok" | 403 | 404;
/** Returned instead of a page when access is refused (a named type, so `"denied" in x` narrows). */
export interface Denied {
  denied: 403 | 404;
}
const deny = (status: 403 | 404): Denied => ({ denied: status });
export function access(perms: Permissions, node: Node): Access {
  if (!perms.can("node.view", node)) return 404;
  return perms.can("node.read", node) ? "ok" : 403;
}

/** Nodes the viewer can see, with every ancestor also visible (a tree, not scattered nodes). */
function visibleTree(perms: Permissions, all: Node[]): Node[] {
  const byId = new Map(all.map((n) => [n.id, n]));
  const ok = (n: Node): boolean =>
    perms.can("node.view", n) && (n.parentId === null || (byId.has(n.parentId) && ok(byId.get(n.parentId)!)));
  return all.filter(ok);
}

async function lastPosts(
  repos: Repositories,
  postIds: (Id | null)[],
  readable: (nodeId: Id) => boolean,
): Promise<Map<Id, LastPost>> {
  const posts = await repos.posts.getMany(postIds.filter((x): x is Id => x !== null));
  const topics = await repos.topics.getMany([...posts.values()].map((p) => p.topicId));
  // A parent forum's last post may live in a sub-forum the viewer cannot read.
  for (const [id, p] of posts) {
    const topic = topics.get(p.topicId);
    if (!topic || !readable(topic.nodeId)) posts.delete(id);
  }
  const users = await repos.users.getMany(
    [...posts.values()].flatMap((p) => (p.authorId ? [p.authorId] : [])),
  );
  const out = new Map<Id, LastPost>();
  for (const p of posts.values()) {
    out.set(p.id, {
      postId: p.id,
      topicId: p.topicId,
      topicTitle: topics.get(p.topicId)?.title ?? "",
      at: p.createdAt,
      author: (p.authorId && users.get(p.authorId)?.username) || p.authorName,
    });
  }
  return out;
}

async function forumRows(
  repos: Repositories,
  perms: Permissions,
  forums: Node[],
  all: Node[],
): Promise<ForumRow[]> {
  const byId = new Map(all.map((n) => [n.id, n]));
  const readable = (id: Id) => {
    const n = byId.get(id);
    return !!n && perms.can("node.read", n);
  };
  const last = await lastPosts(
    repos,
    forums.map((f) => (readable(f.id) ? f.lastPostId : null)),
    readable,
  );
  return forums.map((f) => ({
    id: f.id,
    title: f.title,
    description: f.description,
    locked: f.locked,
    restricted: !readable(f.id),
    topicCount: f.topicCount,
    postCount: f.postCount,
    subforums: all
      .filter((n) => n.parentId === f.id && n.kind !== "category")
      .map((n) => ({ id: n.id, title: n.title })),
    lastPost: f.lastPostId ? (last.get(f.lastPostId) ?? null) : null,
  }));
}

export async function loadIndex(repos: Repositories, perms: Permissions) {
  const all = visibleTree(perms, await repos.nodes.tree());
  const top = all.filter((n) => n.parentId === null);
  // Top-level forums without a category are shown in an untitled group, as phpBB2 did.
  const groups: { id: Id; title: string; nodes: Node[] }[] = [];
  const loose = top.filter((n) => n.kind !== "category");
  if (loose.length) groups.push({ id: 0, title: "", nodes: loose });
  // Every category gets its own section, nested ones too (Przemo allowed categories inside
  // categories), titled with their trail: "Ogólne › Sondy".
  const byParent = (id: Id) => all.filter((n) => n.parentId === id);
  const walk = (cat: Node, trail: string[]) => {
    const title = [...trail, cat.title];
    groups.push({
      id: cat.id,
      title: title.join(" › "),
      nodes: byParent(cat.id).filter((n) => n.kind !== "category"),
    });
    for (const sub of byParent(cat.id).filter((n) => n.kind === "category")) walk(sub, title);
  };
  for (const cat of top.filter((n) => n.kind === "category")) walk(cat, []);
  const categories = await Promise.all(
    groups
      .filter((g) => g.nodes.length)
      .map(async (g) => ({ id: g.id, title: g.title, forums: await forumRows(repos, perms, g.nodes, all) })),
  );
  const readable = all.filter((n) => perms.can("node.read", n));
  const newest = await repos.users.newest();
  return {
    categories,
    stats: {
      posts: readable.reduce((s, n) => s + n.postCount, 0),
      topics: readable.reduce((s, n) => s + n.topicCount, 0),
      users: await repos.users.count(),
      newest: newest ? { id: newest.id, name: newest.username } : null,
    },
  };
}

async function crumbs(repos: Repositories, node: Node): Promise<Crumb[]> {
  const ids = node.path.split("/").filter(Boolean).map(Number);
  const nodes = await Promise.all(ids.map((id) => repos.nodes.get(id)));
  return nodes.filter((n): n is Node => !!n).map((n) => ({ id: n.id, title: n.title, kind: n.kind }));
}

export interface TopicRow {
  id: Id;
  title: string;
  type: Topic["type"];
  locked: boolean;
  movedToTopicId: Id | null;
  author: string;
  replyCount: number;
  viewCount: number;
  lastPost: LastPost | null;
}

export async function loadForum(repos: Repositories, perms: Permissions, id: Id, startParam: unknown) {
  const node = await repos.nodes.get(id);
  if (!node || node.kind === "link") return deny(404);
  const all = visibleTree(perms, await repos.nodes.tree());
  const allowed = all.some((n) => n.id === node.id) ? access(perms, node) : 404;
  if (allowed !== "ok") return deny(allowed);
  const children = all.filter((n) => n.parentId === node.id && n.kind !== "category");
  const subforums = await forumRows(repos, perms, children, all);
  const first = await repos.topics.listByNode(node.id, { page: 1, perPage: 1 });
  const start = normaliseStart(startParam, TOPICS_PER_PAGE, first.total);
  const page = await repos.topics.listByNode(node.id, {
    page: start / TOPICS_PER_PAGE + 1,
    perPage: TOPICS_PER_PAGE,
  });
  const last = await lastPosts(
    repos,
    page.items.map((t) => t.lastPostId),
    () => true,
  );
  const authors = await repos.users.getMany(page.items.flatMap((t) => (t.authorId ? [t.authorId] : [])));
  const topics: TopicRow[] = page.items.map((t) => ({
    id: t.id,
    title: t.title,
    type: t.type,
    locked: t.locked,
    movedToTopicId: t.movedToTopicId,
    author: (t.authorId && authors.get(t.authorId)?.username) || t.authorName,
    replyCount: t.replyCount,
    viewCount: t.viewCount,
    lastPost: t.lastPostId ? (last.get(t.lastPostId) ?? null) : null,
  }));
  return {
    forum: {
      id: node.id,
      title: node.title,
      description: node.description,
      kind: node.kind,
      locked: node.locked,
    },
    breadcrumbs: await crumbs(repos, node),
    subforums,
    topics,
    total: page.total,
    start,
    perPage: TOPICS_PER_PAGE,
  };
}

export interface PostView {
  id: Id;
  at: number;
  editedAt: number | null;
  author: string;
  authorId: Id | null;
  authorPosts: number | null;
  authorJoined: number | null;
  authorLocation: string;
  html: string;
}

/** Where a post lives, for `viewtopic.php?p=` links. */
export async function locatePost(repos: Repositories, perms: Permissions, postId: Id) {
  const post = await repos.posts.get(postId);
  if (!post || post.visibility !== "core:public") return null;
  const topic = await repos.topics.get(post.topicId);
  const node = topic && (await repos.nodes.get(topic.nodeId));
  if (!node) return null;
  const allowed = access(perms, node);
  if (allowed !== "ok") return deny(allowed);
  const position = await repos.posts.positionInTopic(postId);
  if (position === undefined) return null;
  return { topicId: post.topicId, start: Math.floor(position / POSTS_PER_PAGE) * POSTS_PER_PAGE };
}

export async function loadTopic(
  repos: Repositories,
  perms: Permissions,
  render: (posts: Post[]) => Promise<Map<Id, string>>,
  id: Id,
  startParam: unknown,
) {
  const topic = await repos.topics.get(id);
  if (!topic || topic.visibility !== "core:public") return null;
  const node = await repos.nodes.get(topic.nodeId);
  if (!node) return null;
  const allowed = access(perms, node);
  if (allowed !== "ok") return deny(allowed);
  if (topic.movedToTopicId) return { movedTo: topic.movedToTopicId } as const;
  const total = topic.replyCount + 1;
  const start = normaliseStart(startParam, POSTS_PER_PAGE, total);
  const page = await repos.posts.listByTopic(topic.id, {
    page: start / POSTS_PER_PAGE + 1,
    perPage: POSTS_PER_PAGE,
  });
  const html = await render(page.items);
  const users = await repos.users.getMany(page.items.flatMap((p) => (p.authorId ? [p.authorId] : [])));
  await repos.topics.addViews(topic.id, 1);
  const posts: PostView[] = page.items.map((p) => {
    const u = p.authorId ? users.get(p.authorId) : undefined;
    return {
      id: p.id,
      at: p.createdAt,
      editedAt: p.editedAt,
      author: u?.username || p.authorName,
      authorId: u?.id ?? null,
      authorPosts: u ? u.postCount : null,
      authorJoined: u ? u.createdAt : null,
      authorLocation: u?.location ?? "",
      html: html.get(p.id) ?? "",
    };
  });
  return {
    topic: {
      id: topic.id,
      title: topic.title,
      type: topic.type,
      locked: topic.locked,
      viewCount: topic.viewCount + 1,
    },
    breadcrumbs: await crumbs(repos, node),
    posts,
    total: page.total,
    start,
    perPage: POSTS_PER_PAGE,
  };
}
