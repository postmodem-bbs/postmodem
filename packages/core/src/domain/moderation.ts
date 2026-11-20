// SPDX-License-Identifier: AGPL-3.0-or-later
// Moderation (M2 slice 2): vanilla phpBB2's modcp (lock, move, split, merge, delete, topic
// type) and bans. Every action is checked against the moderator's capabilities in the forums
// involved and written to the audit log with the moderator and their reason (extension point
// #9, "moderation events", is these audit entries until the package runtime adds listeners).
//
// Kept from phpBB2: a moved topic can leave a "moved" shadow in its old forum; deleting a
// topic takes its posts out of the posters' counts. Improved: a merged topic becomes a shadow
// of the target, so its old links keep working.
import type { Permissions } from "./core-permissions.ts";
import type { ContentHooks } from "./hooks.ts";
import type { Repositories } from "./ports.ts";
import { cleanTitle, titleProblem } from "./posting.ts";
import type { Ban, Id, Millis, Node, Topic, TopicType, User } from "./types.ts";

export type ModerationProblem =
  | "forbidden"
  | "not-found"
  | "same-forum"
  | "title-missing"
  | "title-long"
  | "nothing-selected"
  | "invalid";

export type ModerationResult<T = Topic> = { ok: true; topic: T } | { ok: false; problem: ModerationProblem };

const no = (problem: ModerationProblem) => ({ ok: false as const, problem });

async function topicIn(
  repos: Repositories,
  perms: Permissions,
  topicId: Id,
  capability: string,
  forUpdate = false,
) {
  const topic = await repos.topics.get(topicId, { forUpdate });
  if (topic?.visibility !== "core:public" || topic.movedToTopicId) return null;
  const node = await repos.nodes.get(topic.nodeId);
  if (!node || !perms.can("node.read", node)) return null;
  return { topic, node, allowed: perms.can(capability, node) };
}

const audit = (
  repos: Repositories,
  actor: User,
  action: string,
  topicId: Id,
  details: Record<string, unknown>,
) =>
  repos.audit.append({
    actorId: actor.id,
    action: `moderation.${action}`,
    targetType: "topic",
    targetId: String(topicId),
    details,
  });

/** Whether the viewer moderates this forum at all (shows the moderator tools). */
export const moderates = (perms: Permissions, node: Node) =>
  ["moderate.lock", "moderate.move", "moderate.split", "moderate.delete", "moderate.edit"].some((c) =>
    perms.can(c, node),
  );

export async function lockTopic(
  repos: Repositories,
  perms: Permissions,
  actor: User,
  topicId: Id,
  locked: boolean,
  reason: string,
): Promise<ModerationResult> {
  const found = await topicIn(repos, perms, topicId, "moderate.lock");
  if (!found) return no("not-found");
  if (!found.allowed) return no("forbidden");
  return repos.transaction(async (r) => {
    await r.topics.setLocked(topicId, locked);
    await audit(r, actor, locked ? "locked" : "unlocked", topicId, { reason });
    return { ok: true as const, topic: (await r.topics.get(topicId))! };
  });
}

export async function setTopicType(
  repos: Repositories,
  perms: Permissions,
  actor: User,
  topicId: Id,
  type: TopicType,
  reason: string,
): Promise<ModerationResult> {
  const found = await topicIn(repos, perms, topicId, "moderate.edit");
  if (!found) return no("not-found");
  const { node } = found;
  const allowed =
    type === "announcement"
      ? perms.can("topic.announce", node)
      : type === "sticky"
        ? perms.can("topic.sticky", node)
        : type === "normal";
  if (!allowed || !(found.allowed || perms.can("topic.sticky", node))) return no("forbidden");
  return repos.transaction(async (r) => {
    await r.topics.setType(topicId, type);
    await audit(r, actor, "type-changed", topicId, { from: found.topic.type, to: type, reason });
    return { ok: true as const, topic: (await r.topics.get(topicId))! };
  });
}

export async function moveTopic(
  repos: Repositories,
  perms: Permissions,
  actor: User,
  topicId: Id,
  targetNodeId: Id,
  opts: { shadow: boolean; reason: string; now?: Millis },
): Promise<ModerationResult> {
  return repos.transaction(async (r) => {
    const found = await topicIn(r, perms, topicId, "moderate.move", true);
    if (!found) return no("not-found");
    if (!found.allowed) return no("forbidden");
    const target = await r.nodes.get(targetNodeId);
    if (target?.kind !== "forum" || !perms.can("node.read", target)) return no("not-found");
    if (target.id === found.node.id) return no("same-forum");
    const { topic, node } = found;
    await r.topics.moveTo(topic.id, target.id);
    if (opts.shadow)
      await r.topics.create({
        nodeId: node.id,
        title: topic.title,
        authorId: topic.authorId,
        authorName: topic.authorName,
        movedToTopicId: topic.id,
        createdAt: opts.now ?? Date.now(),
      });
    await r.nodes.recount(node.id);
    await r.nodes.recount(target.id);
    await audit(r, actor, "moved", topic.id, {
      from: node.id,
      to: target.id,
      shadow: opts.shadow,
      reason: opts.reason,
    });
    return { ok: true as const, topic: (await r.topics.get(topic.id))! };
  });
}

export async function deleteTopic(
  repos: Repositories,
  perms: Permissions,
  actor: User,
  topicId: Id,
  reason: string,
  hooks?: ContentHooks,
): Promise<ModerationResult> {
  return repos.transaction(async (r) => {
    const found = await topicIn(r, perms, topicId, "moderate.delete", true);
    if (!found) return no("not-found");
    if (!found.allowed) return no("forbidden");
    const redirect = await hooks?.beforeDelete?.({ topic: found.topic, node: found.node, actor }, r);
    const posts = (await r.posts.allInTopic(topicId)).filter((p) => p.visibility === "core:public");
    if (redirect) await r.topics.moveTo(topicId, redirect.nodeId);
    await r.topics.setVisibility(topicId, redirect?.visibility ?? "core:deleted");
    const counts = new Map<Id, number>();
    for (const post of posts) {
      if (post.authorId !== null) counts.set(post.authorId, (counts.get(post.authorId) ?? 0) + 1);
    }
    for (const [author, count] of [...counts].sort(([a], [b]) => a - b))
      await r.users.adjustPostCount(author, -count);
    await r.nodes.recount(found.node.id);
    for (let start = 0; start < posts.length; start += 500)
      await r.search.remove(posts.slice(start, start + 500).map((p) => p.id));
    await audit(r, actor, redirect ? "trashed" : "deleted", topicId, {
      posts: posts.length,
      reason,
      ...(redirect && { from: found.node.id, to: redirect.nodeId }),
    });
    return { ok: true as const, topic: (await r.topics.get(topicId))! };
  });
}

/** Moves the selected posts into a new topic, in this forum or another. */
export async function splitTopic(
  repos: Repositories,
  perms: Permissions,
  actor: User,
  input: { topicId: Id; postIds: Id[]; title: string; targetNodeId?: Id; reason: string },
): Promise<ModerationResult> {
  return repos.transaction(async (r) => {
    const found = await topicIn(r, perms, input.topicId, "moderate.split", true);
    if (!found) return no("not-found");
    if (!found.allowed) return no("forbidden");
    const title = cleanTitle(input.title);
    const tp = titleProblem(title);
    if (tp) return no(tp as ModerationProblem);
    const target = input.targetNodeId ? await r.nodes.get(input.targetNodeId) : found.node;
    if (target?.kind !== "forum" || !perms.can("node.read", target)) return no("not-found");
    const posts = (await r.posts.allInTopic(input.topicId)).filter((p) => p.visibility === "core:public");
    const chosen = posts.filter((p) => input.postIds.includes(p.id));
    // At least one post must stay and one must go.
    if (!chosen.length || chosen.length === posts.length) return no("nothing-selected");
    const first = chosen[0]!;
    const created = await r.topics.create({
      nodeId: target.id,
      title,
      authorId: first.authorId,
      authorName: first.authorName,
      createdAt: first.createdAt,
    });
    await r.posts.moveTo(
      chosen.map((p) => p.id),
      created.id,
    );
    await r.topics.recount(input.topicId);
    await r.topics.recount(created.id);
    await r.nodes.recount(found.node.id);
    if (target.id !== found.node.id) await r.nodes.recount(target.id);
    await audit(r, actor, "split", input.topicId, {
      into: created.id,
      posts: chosen.length,
      reason: input.reason,
    });
    return { ok: true as const, topic: (await r.topics.get(created.id))! };
  });
}

/** Moves every post of `sourceId` into `targetId`; the source becomes a shadow pointing at it. */
export async function mergeTopics(
  repos: Repositories,
  perms: Permissions,
  actor: User,
  sourceId: Id,
  targetId: Id,
  reason: string,
): Promise<ModerationResult> {
  if (sourceId === targetId) return no("invalid");
  return repos.transaction(async (r) => {
    // Lock in ID order so simultaneous merges cannot lock the pair in opposite order.
    await r.topics.get(Math.min(sourceId, targetId), { forUpdate: true });
    await r.topics.get(Math.max(sourceId, targetId), { forUpdate: true });
    const source = await topicIn(r, perms, sourceId, "moderate.split");
    const target = await topicIn(r, perms, targetId, "moderate.split");
    if (!source || !target) return no("not-found");
    if (!source.allowed || !target.allowed) return no("forbidden");
    const posts = await r.posts.allInTopic(sourceId);
    await r.posts.moveTo(
      posts.map((p) => p.id),
      targetId,
    );
    await r.topics.recount(sourceId);
    await r.topics.recount(targetId);
    // The emptied topic stays as a shadow, so its old links lead to the merged topic.
    await r.topics.markMoved(sourceId, targetId);
    await r.nodes.recount(source.node.id);
    if (target.node.id !== source.node.id) await r.nodes.recount(target.node.id);
    await audit(r, actor, "merged", sourceId, { into: targetId, posts: posts.length, reason });
    return { ok: true as const, topic: (await r.topics.get(targetId))! };
  });
}

// ── bans ─────────────────────────────────────────────────────────────────────

/** phpBB2-style wildcard match: `*` stands for anything (IPs: 192.168.*; e-mail: *@spam.example). */
export function wildcardMatch(pattern: string, value: string): boolean {
  const re = new RegExp(
    `^${pattern
      .split("*")
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
    "i",
  );
  return re.test(value);
}

/** The first ban that applies to this visitor, if any. */
export function findBan(
  bans: Ban[],
  who: { userId?: Id | null; ip?: string; email?: string | null },
): Ban | undefined {
  return bans.find(
    (b) =>
      (b.kind === "user" && who.userId != null && b.value === String(who.userId)) ||
      (b.kind === "ip" && !!who.ip && wildcardMatch(b.value, who.ip)) ||
      (b.kind === "email" && !!who.email && wildcardMatch(b.value, who.email)),
  );
}

export function banProblem(kind: Ban["kind"], value: string): string | null {
  if (!value.trim()) return "empty";
  if (kind === "ip" && !/^[0-9a-f:.*]+$/i.test(value)) return "ip";
  if (kind === "email" && !/^[^\s@]*@[^\s@]+$/.test(value)) return "email";
  if (kind === "user" && !/^\d+$/.test(value)) return "user";
  return null;
}

/**
 * Bans a user: every session ends and the ban is listed. Their status doesn't change, so a
 * timed ban simply stops applying when it expires; sign-in and every request check the list.
 */
export async function banUser(
  repos: Repositories,
  /** null: the operator at the console (postmodem ban). */
  actor: User | null,
  userId: Id,
  opts: { reason: string; expiresAt: Millis | null },
): Promise<Ban | null> {
  const user = await repos.users.get(userId);
  if (!user || user.id === actor?.id) return null;
  return repos.transaction(async (r) => {
    await r.sessions.removeForUser(user.id);
    const ban = await r.bans.create({
      kind: "user",
      value: String(user.id),
      reason: opts.reason,
      createdBy: actor?.id ?? null,
      expiresAt: opts.expiresAt,
    });
    await r.audit.append({
      actorId: actor?.id ?? null,
      action: "ban.created",
      targetType: "user",
      targetId: String(user.id),
      details: { reason: opts.reason },
    });
    return ban;
  });
}
