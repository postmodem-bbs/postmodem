// SPDX-License-Identifier: AGPL-3.0-or-later
// Read models for the board pages. Every lookup is batched (getMany), never per row.
// No permission checks yet: everything in the board is public until M1 slice 5.
import type { Id, Node, Post, Repositories, Topic } from "@postmodem/core";
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

async function lastPosts(repos: Repositories, postIds: (Id | null)[]): Promise<Map<Id, LastPost>> {
  const posts = await repos.posts.getMany(postIds.filter((x): x is Id => x !== null));
  const topics = await repos.topics.getMany([...posts.values()].map((p) => p.topicId));
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

async function forumRows(repos: Repositories, forums: Node[], all: Node[]): Promise<ForumRow[]> {
  const last = await lastPosts(
    repos,
    forums.map((f) => f.lastPostId),
  );
  return forums.map((f) => ({
    id: f.id,
    title: f.title,
    description: f.description,
    locked: f.locked,
    topicCount: f.topicCount,
    postCount: f.postCount,
    subforums: all
      .filter((n) => n.parentId === f.id && n.kind !== "category")
      .map((n) => ({ id: n.id, title: n.title })),
    lastPost: f.lastPostId ? (last.get(f.lastPostId) ?? null) : null,
  }));
}

export async function loadIndex(repos: Repositories) {
  const all = await repos.nodes.tree();
  const top = all.filter((n) => n.parentId === null);
  // Top-level forums without a category are shown in an untitled group, as phpBB2 did.
  const groups: { id: Id; title: string; nodes: Node[] }[] = [];
  const loose = top.filter((n) => n.kind !== "category");
  if (loose.length) groups.push({ id: 0, title: "", nodes: loose });
  for (const cat of top.filter((n) => n.kind === "category")) {
    groups.push({
      id: cat.id,
      title: cat.title,
      nodes: all.filter((n) => n.parentId === cat.id && n.kind !== "category"),
    });
  }
  const categories = await Promise.all(
    groups.map(async (g) => ({ id: g.id, title: g.title, forums: await forumRows(repos, g.nodes, all) })),
  );
  const newest = await repos.users.newest();
  return {
    categories,
    stats: {
      posts: all.reduce((s, n) => s + n.postCount, 0),
      topics: all.reduce((s, n) => s + n.topicCount, 0),
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

export async function loadForum(repos: Repositories, id: Id, startParam: unknown) {
  const node = await repos.nodes.get(id);
  if (!node || node.kind === "link") return null;
  const all = await repos.nodes.tree();
  const children = all.filter((n) => n.parentId === node.id && n.kind !== "category");
  const subforums = await forumRows(repos, children, all);
  const first = await repos.topics.listByNode(node.id, { page: 1, perPage: 1 });
  const start = normaliseStart(startParam, TOPICS_PER_PAGE, first.total);
  const page = await repos.topics.listByNode(node.id, {
    page: start / TOPICS_PER_PAGE + 1,
    perPage: TOPICS_PER_PAGE,
  });
  const last = await lastPosts(
    repos,
    page.items.map((t) => t.lastPostId),
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
export async function locatePost(repos: Repositories, postId: Id) {
  const post = await repos.posts.get(postId);
  if (!post || post.visibility !== "core:public") return null;
  const position = await repos.posts.positionInTopic(postId);
  if (position === undefined) return null;
  return { topicId: post.topicId, start: Math.floor(position / POSTS_PER_PAGE) * POSTS_PER_PAGE };
}

export async function loadTopic(
  repos: Repositories,
  render: (posts: Post[]) => Promise<Map<Id, string>>,
  id: Id,
  startParam: unknown,
) {
  const topic = await repos.topics.get(id);
  if (!topic || topic.visibility !== "core:public") return null;
  if (topic.movedToTopicId) return { movedTo: topic.movedToTopicId } as const;
  const node = await repos.nodes.get(topic.nodeId);
  if (!node) return null;
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
