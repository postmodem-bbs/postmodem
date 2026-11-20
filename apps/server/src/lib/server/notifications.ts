// SPDX-License-Identifier: AGPL-3.0-or-later
// Notifications (M2 slice 5): phpBB2's topic watching and private-message e-mails. Every
// e-mail goes through the job queue, in the recipient's language, and only to members who
// can still read what it's about (a watcher who lost access to a forum gets nothing).
import {
  boardName,
  defaultLocale,
  digestHour,
  loadSnapshot,
  type Post,
  type PrivateMessage,
  permissionsFor,
  type Topic,
  type User,
  urlStyle,
  viewerFor,
} from "@postmodem/core";
import { negotiate, translator } from "@postmodem/i18n";
import { excerpt } from "@postmodem/markup";
import { topicRef } from "./board.ts";
import type { AppContext } from "./bootstrap.ts";
import { urlsFor } from "./links.ts";
import { replyMail } from "./platform.ts";

const linkTo = (ctx: AppContext, path: string) => new URL(path, ctx.config.publicUrl).href;
/** The recipient's language, else the board's. */
const localeOf = (ctx: AppContext, user: User) =>
  negotiate({ requested: user.locale ?? undefined, boardDefault: ctx.settings.get(defaultLocale) });
const t = (ctx: AppContext, user: User) => translator(localeOf(ctx, user));

/** After a new topic or reply: watch it (if the author wants that), and tell the watchers. */
/** Publishes a live update; a failure costs only the update, never the request. */
export async function live(
  ctx: AppContext,
  channel: string,
  scope: number | null,
  event: string,
  data: Record<string, unknown> = {},
) {
  try {
    await ctx.platform.channels.publish(channel, scope, event, data);
  } catch (e) {
    ctx.log.warn("could not publish a live update", { channel, error: (e as Error).message });
  }
}

export async function afterPost(
  ctx: AppContext,
  urls: ReturnType<typeof urlsFor>,
  topic: Topic,
  post: Post,
  author: User,
) {
  const { repos } = ctx.db;
  // Open pages of this topic hear about the new post (live updates, M2b slice 10).
  if (topic.visibility === "core:public")
    await live(ctx, "core.topic", topic.id, "post.created", { postId: post.id, authorId: author.id });
  if (author.autoWatch) await repos.watches.watch(author.id, topic.id);
  const watchers = await repos.watches.takeWatchersToNotify(topic.id, author.id);
  if (!watchers.length) return;
  const node = await repos.nodes.get(topic.nodeId);
  if (!node) return;
  const snapshot = await loadSnapshot(repos);
  const people = await repos.users.getMany(watchers);
  for (const id of watchers) {
    const user = people.get(id);
    if (!user?.email || user.status !== "active") continue;
    const perms = permissionsFor(ctx.capabilities, snapshot, await viewerFor(repos, id));
    if (!perms.can("node.read", node)) continue;
    const mode = (await ctx.platform.preferences.forReader(id, undefined)).get(replyMail);
    if (mode === "off") continue;
    if (mode === "daily") {
      const dueAt = nextDigestAt(Date.now(), ctx.settings.get(digestHour), user.timezone);
      await repos.digests.add({ userId: id, topicId: topic.id, since: post.createdAt, dueAt });
      continue;
    }
    const tr = t(ctx, user);
    const vars = {
      name: user.username,
      author: author.username,
      topic: topic.title,
      board: ctx.settings.get(boardName),
      link: linkTo(ctx, urls.post(post.id)),
      unwatch: linkTo(ctx, urls.topic(topicRef(topic))),
      excerpt: excerpt(post.source, 300),
    };
    await ctx.sendMail({
      to: user.email,
      subject: tr("mail-reply-subject", vars),
      text: tr("mail-reply-body", vars),
      locale: localeOf(ctx, user),
    });
  }
}

/** A member read the topic: their next reply notification can go out, and it leaves their digest. */
export async function topicVisited(ctx: AppContext, user: User | null, topic: Topic) {
  if (!user) return;
  await ctx.db.repos.watches.visited(user.id, topic.id);
  await ctx.db.repos.digests.forget(user.id, topic.id);
}

/** Local wall-clock parts of an instant in a time zone (UTC if the zone is unknown). */
function wallClock(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
}

/**
 * The next time it's `hour`:00 in the member's time zone (UTC when unset or unknown), after
 * `now`. Where daylight saving skips that hour, the digest goes out an hour later.
 */
export function nextDigestAt(now: number, hour: number, timeZone: string | null): number {
  let zone = timeZone ?? "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const local = wallClock(now, zone);
  const day = new Date(local);
  for (let add = 0; add < 3; add++) {
    const wanted = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + add, hour);
    // The instant whose wall clock reads `wanted`: correct the offset twice for DST changes.
    let at = wanted - (wallClock(wanted, zone) - wanted);
    at += wanted - wallClock(at, zone);
    if (at > now) return at;
  }
  return now + 24 * 3600_000;
}

/** At most this many members' digests per run; the rest go out in the next one. */
const DIGESTS_PER_RUN = 200;

/**
 * Sends the digests that are due: per member, one e-mail listing each watched topic with
 * replies since they last heard about it. Topics they can no longer read, and ones whose
 * replies are all gone, are left out. Returns how many e-mails were queued.
 */
export async function sendDigests(ctx: AppContext, now = Date.now()): Promise<number> {
  const { repos } = ctx.db;
  const entries = await repos.digests.takeDue(now, DIGESTS_PER_RUN);
  if (!entries.length) return 0;
  const urls = urlsFor(ctx.settings.get(urlStyle));
  const snapshot = await loadSnapshot(repos);
  const people = await repos.users.getMany([...new Set(entries.map((e) => e.userId))]);
  const topics = await repos.topics.getMany([...new Set(entries.map((e) => e.topicId))]);
  const nodes = new Map((await repos.nodes.tree()).map((n) => [n.id, n]));
  let sent = 0;
  for (const userId of new Set(entries.map((e) => e.userId))) {
    const user = people.get(userId);
    if (!user?.email || user.status !== "active") continue;
    // A member who switched to "off" since gets nothing; "instant" still gets what was collected.
    if ((await ctx.platform.preferences.forReader(userId, undefined)).get(replyMail) === "off") continue;
    const perms = permissionsFor(ctx.capabilities, snapshot, await viewerFor(repos, userId));
    const lines: string[] = [];
    for (const entry of entries.filter((e) => e.userId === userId)) {
      const topic = topics.get(entry.topicId);
      const node = topic && nodes.get(topic.nodeId);
      if (!topic || topic.visibility !== "core:public" || !node || !perms.can("node.read", node)) continue;
      const fresh = await repos.posts.newSince(topic.id, entry.since, userId);
      if (!fresh.count || fresh.first === null) continue;
      lines.push(
        t(ctx, user)("mail-digest-topic", {
          topic: topic.title,
          count: fresh.count,
          link: linkTo(ctx, urls.post(fresh.first)),
        }),
      );
    }
    if (!lines.length) continue;
    const tr = t(ctx, user);
    const vars = {
      name: user.username,
      board: ctx.settings.get(boardName),
      count: lines.length,
      topics: lines.join("\n\n"),
      settings: linkTo(ctx, "/account"),
    };
    await ctx.sendMail({
      to: user.email,
      subject: tr("mail-digest-subject", vars),
      text: tr("mail-digest-body", vars),
      locale: localeOf(ctx, user),
    });
    sent++;
  }
  return sent;
}

/** "You have a new private message", if the recipient wants it. Never the message itself. */
export async function afterMessage(
  ctx: AppContext,
  message: PrivateMessage,
  recipient: User,
  sender: User | null,
) {
  await live(ctx, "core.user", recipient.id, "message.received", { messageId: message.id });
  if (!recipient.notifyPm || !recipient.email || recipient.status !== "active") return;
  const tr = t(ctx, recipient);
  const vars = {
    name: recipient.username,
    from: sender?.username ?? ctx.settings.get(boardName),
    board: ctx.settings.get(boardName),
    link: linkTo(ctx, `/privmsg.php?mode=read&p=${message.id}`),
  };
  await ctx.sendMail({
    to: recipient.email,
    subject: tr("mail-pm-subject", vars),
    text: tr("mail-pm-body", vars),
    locale: localeOf(ctx, recipient),
  });
}
