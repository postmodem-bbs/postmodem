// SPDX-License-Identifier: AGPL-3.0-or-later
// Notifications (M2 slice 5): phpBB2's topic watching and private-message e-mails. Every
// e-mail goes through the job queue, in the recipient's language, and only to members who
// can still read what it's about (a watcher who lost access to a forum gets nothing).
import {
  boardName,
  defaultLocale,
  loadSnapshot,
  type Post,
  type PrivateMessage,
  permissionsFor,
  type Topic,
  type User,
  viewerFor,
} from "@postmodem/core";
import { negotiate, translator } from "@postmodem/i18n";
import { excerpt } from "@postmodem/markup";
import { topicRef } from "./board.ts";
import type { AppContext } from "./bootstrap.ts";
import type { urlsFor } from "./links.ts";

const linkTo = (ctx: AppContext, path: string) => new URL(path, ctx.config.publicUrl).href;
/** The recipient's language, else the board's. */
const localeOf = (ctx: AppContext, user: User) =>
  negotiate({ requested: user.locale ?? undefined, boardDefault: ctx.settings.get(defaultLocale) });
const t = (ctx: AppContext, user: User) => translator(localeOf(ctx, user));

/** After a new topic or reply: watch it (if the author wants that), and tell the watchers. */
export async function afterPost(
  ctx: AppContext,
  urls: ReturnType<typeof urlsFor>,
  topic: Topic,
  post: Post,
  author: User,
) {
  const { repos } = ctx.db;
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

/** A member read the topic: their next reply notification can go out. */
export function topicVisited(ctx: AppContext, user: User | null, topic: Topic) {
  return user ? ctx.db.repos.watches.visited(user.id, topic.id) : Promise.resolve();
}

/** "You have a new private message", if the recipient wants it. Never the message itself. */
export async function afterMessage(
  ctx: AppContext,
  message: PrivateMessage,
  recipient: User,
  sender: User | null,
) {
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
