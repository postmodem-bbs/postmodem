// SPDX-License-Identifier: AGPL-3.0-or-later
// Read models for the board pages. Every lookup is batched (getMany), never per row.
// Permission-aware (ADR 0015): forums without node.view are invisible (and 404), forums with
// node.view but not node.read are listed but closed (403), and nothing from an unreadable
// forum (last-post titles, counts) leaks through a readable one.
import {
  boardAdmins,
  type ContentHooks,
  type Decoration,
  type Id,
  may,
  moderates,
  type Node,
  type Permissions,
  type Poll,
  type Post,
  packageDenial,
  type Rank,
  type Repositories,
  resolveRank,
  type Topic,
} from "@postmodem/core";
import { excerpt } from "@postmodem/markup";
import { normaliseStart, POSTS_PER_PAGE, TOPICS_PER_PAGE } from "../pagination.ts";
import type { NodeRef, TopicRef, UserRef } from "../urls.ts";

export { POSTS_PER_PAGE, TOPICS_PER_PAGE };

/** Category numbers for classic `index.php?c=` links (see links.ts). */
export type ClassicIds = ReadonlyMap<Id, Id | null>;

export const nodeRef = (n: Node, classic?: ClassicIds): NodeRef => ({
  id: n.id,
  slug: n.slug,
  kind: n.kind,
  ...(n.kind === "category" ? { classicId: classic ? (classic.get(n.id) ?? null) : n.id } : {}),
});
export const topicRef = (t: Topic): TopicRef => ({ id: t.id, slug: t.slug });

export interface LastPost {
  postId: Id;
  topic: TopicRef;
  topicTitle: string;
  at: number;
  author: string; // "" = guest without a name
}
/** What packages add to list rows (extension point #2), from the package host. */
export interface Decorate {
  topics?(topics: Topic[]): Promise<Map<Id, Decoration[]>>;
  forums?(nodes: Node[]): Promise<Map<Id, Decoration[]>>;
}

/** Badges and classes from every decoration of a row, flattened for the templates. */
function flatten(d: Decoration[] | undefined): {
  badges: { key: string; label: string }[];
  classes: string[];
} {
  return {
    badges: (d ?? []).flatMap((x) => x.badges ?? []),
    classes: (d ?? []).flatMap((x) => x.classes ?? []),
  };
}

export interface ForumRow {
  id: Id;
  ref: NodeRef;
  title: string;
  extras: ReturnType<typeof flatten>;
  description: string;
  locked: boolean;
  /** Listed (node.view) but not readable (node.read): counts shown, last post withheld. */
  restricted: boolean;
  topicCount: number;
  postCount: number;
  subforums: { id: Id; ref: NodeRef; title: string }[];
  lastPost: LastPost | null;
}
export interface Crumb {
  id: Id;
  ref: NodeRef;
  title: string;
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
    if (p.visibility !== "core:public" || topic?.visibility !== "core:public" || !readable(topic.nodeId))
      posts.delete(id);
  }
  const users = await repos.users.getMany(
    [...posts.values()].flatMap((p) => (p.authorId ? [p.authorId] : [])),
  );
  const out = new Map<Id, LastPost>();
  for (const p of posts.values()) {
    out.set(p.id, {
      postId: p.id,
      topic: topicRef(topics.get(p.topicId)!),
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
  decorate?: Decorate,
): Promise<ForumRow[]> {
  const decorations =
    (await decorate?.forums?.(forums.filter((f) => perms.can("node.read", f)))) ?? new Map();
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
    ref: nodeRef(f),
    title: f.title,
    extras: flatten(decorations.get(f.id)),
    description: f.description,
    locked: f.locked,
    restricted: !readable(f.id),
    topicCount: f.topicCount,
    postCount: f.postCount,
    subforums: all
      .filter((n) => n.parentId === f.id && n.kind !== "category")
      .map((n) => ({ id: n.id, ref: nodeRef(n), title: n.title })),
    lastPost: f.lastPostId ? (last.get(f.lastPostId) ?? null) : null,
  }));
}

/**
 * The board index, or (phpBB2's `index.php?c=`) one category of it. Returns null when the
 * category doesn't exist or the viewer may not see it.
 */
export async function loadIndex(
  repos: Repositories,
  perms: Permissions,
  opts: { categoryId?: Id; classic?: ClassicIds; decorate?: Decorate } = {},
) {
  const tree = await repos.nodes.tree();
  const all = visibleTree(perms, tree);
  const root = opts.categoryId === undefined ? undefined : all.find((n) => n.id === opts.categoryId);
  if (opts.categoryId !== undefined && root?.kind !== "category") return null;
  const top = root ? [root] : all.filter((n) => n.parentId === null);
  // Top-level forums without a category are shown in an untitled group, as phpBB2 did.
  const groups: { id: Id; ref: NodeRef | null; title: string; nodes: Node[] }[] = [];
  const loose = top.filter((n) => n.kind !== "category");
  if (loose.length) groups.push({ id: 0, ref: null, title: "", nodes: loose });
  // Every category gets its own section, nested ones too (Przemo allowed categories inside
  // categories), titled with their trail: "Ogólne › Sondy".
  const byParent = (id: Id) => all.filter((n) => n.parentId === id);
  const walk = (cat: Node, trail: string[]) => {
    const title = [...trail, cat.title];
    groups.push({
      id: cat.id,
      ref: nodeRef(cat, opts.classic),
      title: title.join(" › "),
      nodes: byParent(cat.id).filter((n) => n.kind !== "category"),
    });
    for (const sub of byParent(cat.id).filter((n) => n.kind === "category")) walk(sub, title);
  };
  const trail = root ? await crumbs(repos, root, opts.classic) : [];
  for (const cat of top.filter((n) => n.kind === "category"))
    walk(
      cat,
      trail.slice(0, -1).map((c) => c.title),
    );
  const categories = await Promise.all(
    groups
      .filter((g) => g.nodes.length)
      .map(async (g) => ({
        id: g.id,
        ref: g.ref,
        title: g.title,
        forums: await forumRows(repos, perms, g.nodes, all, opts.decorate),
      })),
  );
  const readable = all.filter((n) => perms.can("node.read", n));
  const newest = await repos.users.newest();
  const now = Date.now();
  const onlineIds = await repos.sessions.activeUserIds(now - ONLINE_WINDOW_MS, now);
  const onlineUsers = await repos.users.getMany(onlineIds.slice(0, ONLINE_LIST_MAX));
  const online = onlineIds.flatMap((id) => {
    const u = onlineUsers.get(id);
    return u && u.status === "active"
      ? [{ ref: { id: u.id, slug: u.slug } as UserRef, name: u.username }]
      : [];
  });
  return {
    category: root
      ? { ...nodeRef(root, opts.classic), title: root.title, description: root.description }
      : null,
    breadcrumbs: trail.slice(0, -1),
    categories,
    stats: {
      posts: readable.reduce((s, n) => s + n.postCount, 0),
      topics: readable.reduce((s, n) => s + n.topicCount, 0),
      users: await repos.users.count(),
      newest: newest ? { ref: { id: newest.id, slug: newest.slug } as UserRef, name: newest.username } : null,
      /** Signed-in users seen in the last ONLINE_WINDOW_MS (sessions record activity every 5 min). */
      online: {
        count: online.length + Math.max(0, onlineIds.length - ONLINE_LIST_MAX),
        users: online,
        minutes: ONLINE_WINDOW_MS / 60_000,
      },
    },
  };
}

async function crumbs(repos: Repositories, node: Node, classic?: ClassicIds): Promise<Crumb[]> {
  const ids = node.path.split("/").filter(Boolean).map(Number);
  const nodes = await Promise.all(ids.map((id) => repos.nodes.get(id)));
  return nodes
    .filter((n): n is Node => !!n)
    .map((n) => ({ id: n.id, ref: nodeRef(n, classic), title: n.title }));
}

export interface TopicRow {
  id: Id;
  ref: TopicRef;
  title: string;
  extras: ReturnType<typeof flatten>;
  type: Topic["type"];
  locked: boolean;
  /** A shadow left behind by a move: links to where the topic went. */
  movedTo: TopicRef | null;
  author: string;
  replyCount: number;
  viewCount: number;
  lastPost: LastPost | null;
}

export async function loadForum(
  repos: Repositories,
  perms: Permissions,
  node: Node,
  startParam: unknown,
  classic?: ClassicIds,
  decorate?: Decorate,
) {
  if (node.kind === "link") return deny(404);
  const all = visibleTree(perms, await repos.nodes.tree());
  const allowed = all.some((n) => n.id === node.id) ? access(perms, node) : 404;
  if (allowed !== "ok") return deny(allowed);
  const children = all.filter((n) => n.parentId === node.id && n.kind !== "category");
  const subforums = await forumRows(repos, perms, children, all, decorate);
  // One query for the requested page; a second only when the request was past the end.
  const fetch = (start: number) =>
    repos.topics.listByNode(node.id, { page: start / TOPICS_PER_PAGE + 1, perPage: TOPICS_PER_PAGE });
  const asked = normaliseStart(startParam, TOPICS_PER_PAGE, Number.MAX_SAFE_INTEGER);
  let page = await fetch(asked);
  const start = normaliseStart(asked, TOPICS_PER_PAGE, page.total);
  if (start !== asked) page = await fetch(start);
  const last = await lastPosts(
    repos,
    page.items.map((t) => t.lastPostId),
    () => true,
  );
  const authors = await repos.users.getMany(page.items.flatMap((t) => (t.authorId ? [t.authorId] : [])));
  const moved = await repos.topics.getMany(
    page.items.flatMap((t) => (t.movedToTopicId ? [t.movedToTopicId] : [])),
  );
  const decorations = (await decorate?.topics?.(page.items)) ?? new Map();
  const topics: TopicRow[] = page.items.map((t) => ({
    id: t.id,
    ref: topicRef(t),
    title: t.title,
    extras: flatten(decorations.get(t.id)),
    type: t.type,
    locked: t.locked,
    movedTo: t.movedToTopicId
      ? topicRef(moved.get(t.movedToTopicId) ?? { ...t, id: t.movedToTopicId, slug: "" })
      : null,
    author: (t.authorId && authors.get(t.authorId)?.username) || t.authorName,
    replyCount: t.replyCount,
    viewCount: t.viewCount,
    lastPost: t.lastPostId ? (last.get(t.lastPostId) ?? null) : null,
  }));
  return {
    forum: {
      ...nodeRef(node, classic),
      title: node.title,
      description: node.description,
      kind: node.kind,
      locked: node.locked,
    },
    canCreateTopic: may.createTopic(perms, node),
    breadcrumbs: await crumbs(repos, node, classic),
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
  editCount: number;
  author: string;
  authorRef: UserRef | null;
  authorPosts: number | null;
  authorJoined: number | null;
  authorLocation: string;
  /** Image URL: one of ours (/avatars/…) or an https URL from an imported remote avatar. */
  authorAvatar: string | null;
  /** phpBB2's rank under the author's name, with its image (#130). */
  authorRank: RankView | null;
  subject: string;
  html: string;
  canEdit: boolean;
  canDelete: boolean;
}

export interface PollView {
  question: string;
  endsAt: number | null;
  ended: boolean;
  /** false while the board hides results until the end. */
  showResults: boolean;
  totalVotes: number;
  options: { text: string; votes: number; percent: number }[];
}

function pollView(poll: Poll | undefined, now = Date.now()): PollView | null {
  if (!poll) return null;
  const ended = poll.endsAt !== null && poll.endsAt <= now;
  const showResults = !poll.hideResults || ended;
  const totalVotes = poll.options.reduce((s, o) => s + o.votes, 0);
  return {
    question: poll.question,
    endsAt: poll.endsAt,
    ended,
    showResults,
    totalVotes: showResults ? totalVotes : 0,
    options: poll.options.map((o) => ({
      text: o.text,
      votes: showResults ? o.votes : 0,
      percent: showResults && totalVotes ? Math.round((o.votes / totalVotes) * 100) : 0,
    })),
  };
}

export interface RankView {
  title: string;
  /** /ranks/… or an imported https URL. */
  image: string | null;
}

/** Where a stored rank image (a path under uploads/ranks, or an https URL) is served from. */
export function rankImageUrl(image: string | null): string | null {
  if (!image) return null;
  if (image.startsWith("https://")) return image;
  return safeUploadPath(image) ? `/ranks/${image.split("/").map(encodeURIComponent).join("/")}` : null;
}

const safeUploadPath = (p: string) =>
  p.length < 256 &&
  !p.startsWith("/") &&
  !/[\\\0]/.test(p) &&
  p.split("/").every((s) => s && s !== "." && s !== "..");

/** The rank a member shows, ready for a page (#130). */
export function rankView(
  ranks: readonly Rank[],
  member: { rankId: Id | null; postCount: number },
): RankView | null {
  const rank = resolveRank(ranks, member);
  return rank && { title: rank.title, image: rankImageUrl(rank.image) };
}

/** Where a stored avatar (`upload/…`, `gallery/…`, or an https URL) is served from. */
export function avatarUrl(avatar: string | null): string | null {
  if (!avatar) return null;
  if (avatar.startsWith("https://")) return avatar;
  return /^(upload|gallery)\//.test(avatar)
    ? `/avatars/${avatar.split("/").map(encodeURIComponent).join("/")}`
    : null;
}

export const ONLINE_WINDOW_MS = 10 * 60_000;
const ONLINE_LIST_MAX = 100;

/** Where a post lives, for `viewtopic.php?p=` links. */
export async function locatePost(repos: Repositories, perms: Permissions, postId: Id) {
  const post = await repos.posts.get(postId);
  if (post?.visibility !== "core:public") return null;
  const topic = await repos.topics.get(post.topicId);
  if (topic?.visibility !== "core:public") return null;
  const node = await repos.nodes.get(topic.nodeId);
  if (!node) return null;
  const allowed = access(perms, node);
  if (allowed !== "ok") return deny(allowed);
  const position = await repos.posts.positionInTopic(postId);
  if (position === undefined) return null;
  return { topic: topicRef(topic), start: Math.floor(position / POSTS_PER_PAGE) * POSTS_PER_PAGE };
}

export async function loadTopic(
  repos: Repositories,
  perms: Permissions,
  render: (posts: Post[], node: Node) => Promise<Map<Id, string>>,
  views: { add(id: Id): void; pending(id: Id): number | Promise<number> },
  topic: Topic,
  startParam: unknown,
  classic?: ClassicIds,
  /** Packages' access filters (EP-5): they may hide Edit and Delete the core would offer. */
  hooks?: ContentHooks,
) {
  if (topic.visibility !== "core:public") return null;
  const node = await repos.nodes.get(topic.nodeId);
  if (!node) return null;
  const allowed = access(perms, node);
  if (allowed !== "ok") return deny(allowed);
  if (topic.movedToTopicId) {
    const target = await repos.topics.get(topic.movedToTopicId);
    if (target?.visibility !== "core:public") return null;
    const destination = await repos.nodes.get(target.nodeId);
    return destination && access(perms, destination) === "ok"
      ? ({ movedTo: topicRef(target) } as const)
      : null;
  }
  const total = topic.replyCount + 1;
  const start = normaliseStart(startParam, POSTS_PER_PAGE, total);
  const page = await repos.posts.listByTopic(topic.id, {
    page: start / POSTS_PER_PAGE + 1,
    perPage: POSTS_PER_PAGE,
  });
  const html = await render(page.items, node);
  const users = await repos.users.getMany(page.items.flatMap((p) => (p.authorId ? [p.authorId] : [])));
  const ranks = await repos.ranks.all();
  views.add(topic.id);
  const admins = hooks?.policy ? await boardAdmins(repos) : new Set<Id>();
  const now = Date.now();
  const packagesAllow = (action: "post.edit" | "post.delete", p: Post) =>
    !packageDenial(hooks, { action, perms, userId: perms.viewer.userId, node, topic, post: p, now }, admins);
  const posts: PostView[] = page.items.map((p) => {
    const u = p.authorId ? users.get(p.authorId) : undefined;
    return {
      id: p.id,
      at: p.createdAt,
      editedAt: p.editedAt,
      editCount: p.editCount,
      author: u?.username || p.authorName,
      authorRef: u ? { id: u.id, slug: u.slug } : null,
      authorPosts: u ? u.postCount : null,
      authorJoined: u ? u.createdAt : null,
      authorLocation: u?.location ?? "",
      authorAvatar: avatarUrl(u?.avatar ?? null),
      authorRank: u ? rankView(ranks, u) : null,
      subject: p.subject,
      canEdit: may.edit(perms, node, topic, p, perms.viewer.userId) && packagesAllow("post.edit", p),
      canDelete: may.delete(perms, node, topic, p, perms.viewer.userId) && packagesAllow("post.delete", p),
      html: html.get(p.id) ?? "",
    };
  });
  // First page: a plain-text summary of the opening post for search engines (no quotes or
  // hidden content, see @postmodem/markup text.ts).
  const first = start === 0 ? page.items[0] : undefined;
  return {
    poll: pollView(await repos.polls.forTopic(topic.id)),
    summary: first
      ? { text: excerpt(first.source, 1000), description: excerpt(first.source), author: posts[0]! }
      : null,
    topic: {
      ...topicRef(topic),
      title: topic.title,
      type: topic.type,
      locked: topic.locked,
      createdAt: topic.createdAt,
      lastPostAt: topic.lastPostAt,
      replies: topic.replyCount,
      canReply: may.reply(perms, node, topic),
      canModerate: moderates(perms, node),
      viewCount: topic.viewCount + (await views.pending(topic.id)),
    },
    breadcrumbs: await crumbs(repos, node, classic),
    posts,
    total: page.total,
    start,
    perPage: POSTS_PER_PAGE,
  };
}
