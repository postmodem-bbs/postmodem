// SPDX-License-Identifier: AGPL-3.0-or-later
// Posting (M2 slice 1): new topics, replies, editing and deleting one's own posts, with
// phpBB2's rules. Permissions come from the capability engine; counters are updated in the
// same transaction (incrementally on create, recounted on the rare delete).
//
// phpBB2 behaviour kept on purpose:
// - Members may delete their own post only while it is the topic's last post; deleting the
//   only post of a topic deletes the topic. Moderators may delete any post.
// - Editing counts as an edit ("edited N times") only once someone has replied after it.
// - Locked topics and forums take no posts or edits, except from moderators.
// - The flood interval doesn't apply to moderators.

import type { Permissions } from "./core-permissions.ts";
import type { Repositories } from "./ports.ts";
import type { Id, Millis, Node, Post, Topic, TopicType, User } from "./types.ts";

export const TITLE_MAX = 100;

export type PostingProblem =
  | "sign-in"
  | "not-found"
  | "forbidden"
  | "locked"
  | "flood"
  | "title-missing"
  | "title-long"
  | "body-missing"
  | "body-long"
  | "not-last-post"
  | "new-member-links";

export type PostingResult =
  | { ok: true; topic: Topic; post: Post }
  | { ok: false; problem: PostingProblem; waitSeconds?: number };

export interface PostingRules {
  floodSeconds: number;
  maxLength: number;
  /** Until a member has this many posts, their posts may not contain links (spam). */
  newMemberPosts?: number;
  now?: Millis;
}

const fail = (problem: PostingProblem, waitSeconds?: number): PostingResult => ({
  ok: false,
  problem,
  ...(waitSeconds ? { waitSeconds } : {}),
});

export function cleanTitle(raw: string): string {
  const visible = [...raw]
    .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch))
    .join("");
  return visible.replace(/\s+/g, " ").trim();
}

export function titleProblem(title: string): PostingProblem | null {
  if (!title) return "title-missing";
  if ([...title].length > TITLE_MAX) return "title-long";
  return null;
}

/** Links in BBCode or bare: what new members may not post yet. */
export const containsLink = (source: string) => /\[(url|img|email)\b|https?:\/\/|\bwww\./i.test(source);

const newMemberLinks = (perms: Permissions, node: Node, user: User, source: string, rules: PostingRules) =>
  !!rules.newMemberPosts &&
  user.postCount < rules.newMemberPosts &&
  !isModerator(perms, node) &&
  containsLink(source);

export function bodyProblem(source: string, maxLength: number): PostingProblem | null {
  if (!source.trim()) return "body-missing";
  if ([...source].length > maxLength) return "body-long";
  return null;
}

/** The poster as the rules see them: signed in and an active member. */
function poster(user: User | null): PostingProblem | null {
  if (!user) return "sign-in";
  return user.status === "active" ? null : "forbidden";
}

const isModerator = (perms: Permissions, node: Node) => perms.can("moderate.edit", node);
const lockedFor = (perms: Permissions, node: Node, topic?: Topic) =>
  (node.locked || !!topic?.locked) && !perms.can("moderate.lock", node);

/**
 * What the viewer may do here, by the same rules the use cases below enforce: for showing
 * buttons and refusing early. The use cases still check everything themselves.
 */
export const may = {
  createTopic: (perms: Permissions, node: Node) =>
    node.kind === "forum" && perms.can("topic.create", node) && !lockedFor(perms, node),
  reply: (perms: Permissions, node: Node, topic: Topic) =>
    !topic.movedToTopicId && perms.can("topic.reply", node) && !lockedFor(perms, node, topic),
  edit: (perms: Permissions, node: Node, topic: Topic, post: Pick<Post, "authorId">, userId: Id | null) =>
    perms.can("moderate.edit", node) ||
    (userId !== null &&
      post.authorId === userId &&
      perms.can("post.edit.own", node) &&
      !lockedFor(perms, node, topic)),
  delete: (
    perms: Permissions,
    node: Node,
    topic: Topic,
    post: Pick<Post, "id" | "authorId">,
    userId: Id | null,
  ) =>
    perms.can("moderate.delete", node) ||
    (userId !== null &&
      post.authorId === userId &&
      topic.lastPostId === post.id &&
      perms.can("post.delete.own", node) &&
      !lockedFor(perms, node, topic)),
};

async function flood(
  repos: Repositories,
  perms: Permissions,
  user: User,
  node: Node,
  rules: PostingRules,
): Promise<number> {
  if (!rules.floodSeconds || isModerator(perms, node)) return 0;
  const last = await repos.posts.lastByAuthor(user.id);
  const now = rules.now ?? Date.now();
  const left = last === undefined ? 0 : last + rules.floodSeconds * 1000 - now;
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/** The forum a new topic goes to, or why not. */
async function postableForum(repos: Repositories, perms: Permissions, nodeId: Id) {
  const node = await repos.nodes.get(nodeId);
  if (node?.kind !== "forum" || !perms.can("node.read", node)) return null;
  return node;
}

/** A public topic and its forum, readable by the viewer. */
async function readableTopic(repos: Repositories, perms: Permissions, topicId: Id) {
  const topic = await repos.topics.get(topicId);
  if (topic?.visibility !== "core:public" || topic.movedToTopicId) return null;
  const node = await repos.nodes.get(topic.nodeId);
  if (!node || !perms.can("node.read", node)) return null;
  return { topic, node };
}

export async function createTopic(
  repos: Repositories,
  perms: Permissions,
  user: User | null,
  input: { nodeId: Id; title: string; source: string; type?: TopicType },
  rules: PostingRules,
): Promise<PostingResult> {
  const who = poster(user);
  if (who) return fail(who);
  const node = await postableForum(repos, perms, input.nodeId);
  if (!node) return fail("not-found");
  if (!perms.can("topic.create", node)) return fail("forbidden");
  if (lockedFor(perms, node)) return fail("locked");
  const type = input.type ?? "normal";
  if (type === "sticky" && !perms.can("topic.sticky", node)) return fail("forbidden");
  if (type === "announcement" && !perms.can("topic.announce", node)) return fail("forbidden");
  const title = cleanTitle(input.title);
  const problem = titleProblem(title) ?? bodyProblem(input.source, rules.maxLength);
  if (problem) return fail(problem);
  if (newMemberLinks(perms, node, user!, input.source, rules)) return fail("new-member-links");
  const wait = await flood(repos, perms, user!, node, rules);
  if (wait) return fail("flood", wait);

  const now = rules.now ?? Date.now();
  return repos.transaction(async (r) => {
    const topic = await r.topics.create({ nodeId: node.id, title, authorId: user!.id, type, createdAt: now });
    const post = await r.posts.create({
      topicId: topic.id,
      authorId: user!.id,
      source: input.source,
      format: "bbcode-phpbb2",
      createdAt: now,
    });
    await r.topics.notePost(topic.id, { id: post.id, createdAt: now, first: true });
    await r.nodes.notePost(node.id, { id: post.id, topic: true });
    await r.users.adjustPostCount(user!.id, 1);
    return { ok: true as const, topic: (await r.topics.get(topic.id))!, post };
  });
}

export async function reply(
  repos: Repositories,
  perms: Permissions,
  user: User | null,
  input: { topicId: Id; source: string; subject?: string },
  rules: PostingRules,
): Promise<PostingResult> {
  const who = poster(user);
  if (who) return fail(who);
  const found = await readableTopic(repos, perms, input.topicId);
  if (!found) return fail("not-found");
  const { topic, node } = found;
  if (!perms.can("topic.reply", node)) return fail("forbidden");
  if (lockedFor(perms, node, topic)) return fail("locked");
  const subject = cleanTitle(input.subject ?? "");
  if ([...subject].length > TITLE_MAX) return fail("title-long");
  const problem = bodyProblem(input.source, rules.maxLength);
  if (problem) return fail(problem);
  if (newMemberLinks(perms, node, user!, input.source, rules)) return fail("new-member-links");
  const wait = await flood(repos, perms, user!, node, rules);
  if (wait) return fail("flood", wait);

  const now = rules.now ?? Date.now();
  return repos.transaction(async (r) => {
    const post = await r.posts.create({
      topicId: topic.id,
      authorId: user!.id,
      subject,
      source: input.source,
      format: "bbcode-phpbb2",
      createdAt: now,
    });
    await r.topics.notePost(topic.id, { id: post.id, createdAt: now, first: false });
    await r.nodes.notePost(node.id, { id: post.id, topic: false });
    await r.users.adjustPostCount(user!.id, 1);
    return { ok: true as const, topic: (await r.topics.get(topic.id))!, post };
  });
}

/** A post the viewer may edit or delete, with its topic and forum. */
async function ownPost(
  repos: Repositories,
  perms: Permissions,
  user: User | null,
  postId: Id,
  own: "post.edit.own" | "post.delete.own",
  moderate: "moderate.edit" | "moderate.delete",
) {
  const who = poster(user);
  if (who) return { problem: who };
  const post = await repos.posts.get(postId);
  if (post?.visibility !== "core:public") return { problem: "not-found" as const };
  const found = await readableTopic(repos, perms, post.topicId);
  if (!found) return { problem: "not-found" as const };
  const { topic, node } = found;
  const moderator = perms.can(moderate, node);
  if (!moderator && !(post.authorId === user!.id && perms.can(own, node)))
    return { problem: "forbidden" as const };
  if (!moderator && lockedFor(perms, node, topic)) return { problem: "locked" as const };
  return { post, topic, node, moderator };
}

export async function editPost(
  repos: Repositories,
  perms: Permissions,
  user: User | null,
  input: { postId: Id; source: string; subject?: string; title?: string },
  rules: PostingRules,
): Promise<PostingResult> {
  const found = await ownPost(repos, perms, user, input.postId, "post.edit.own", "moderate.edit");
  if ("problem" in found) return fail(found.problem!);
  const { post, topic } = found;
  const first = topic.firstPostId === post.id;
  const title = first && input.title !== undefined ? cleanTitle(input.title) : null;
  const subject = cleanTitle(input.subject ?? post.subject);
  const problem =
    (title !== null ? titleProblem(title) : null) ??
    ([...subject].length > TITLE_MAX ? "title-long" : null) ??
    bodyProblem(input.source, rules.maxLength);
  if (problem) return fail(problem);
  if (newMemberLinks(perms, found.node, user!, input.source, rules)) return fail("new-member-links");

  const now = rules.now ?? Date.now();
  // phpBB2: an edit only shows once someone has replied after the post.
  const replied = topic.lastPostId !== post.id;
  return repos.transaction(async (r) => {
    const edited = await r.posts.edit(post.id, {
      source: input.source,
      subject,
      editedAt: replied ? now : post.editedAt,
      editCount: replied ? post.editCount + 1 : post.editCount,
    });
    if (title !== null && title !== topic.title) await r.topics.rename(topic.id, title);
    return { ok: true as const, topic: (await r.topics.get(topic.id))!, post: edited };
  });
}

export async function deletePost(
  repos: Repositories,
  perms: Permissions,
  user: User | null,
  postId: Id,
): Promise<PostingResult & { topicDeleted?: boolean }> {
  const found = await ownPost(repos, perms, user, postId, "post.delete.own", "moderate.delete");
  if ("problem" in found) return fail(found.problem!);
  const { post, topic, node, moderator } = found;
  if (!moderator && topic.lastPostId !== post.id) return fail("not-last-post");
  const only = topic.firstPostId === post.id && topic.lastPostId === post.id;
  return repos.transaction(async (r) => {
    await r.posts.setVisibility(post.id, "core:deleted");
    if (only) await r.topics.setVisibility(topic.id, "core:deleted");
    else await r.topics.recount(topic.id);
    await r.nodes.recount(node.id);
    if (post.authorId) await r.users.adjustPostCount(post.authorId, -1);
    return { ok: true as const, topic: (await r.topics.get(topic.id))!, post, topicDeleted: only };
  });
}
