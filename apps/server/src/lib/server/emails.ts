// SPDX-License-Identifier: AGPL-3.0-or-later
// Account e-mails, rendered in the recipient's language at the moment they're queued.
import {
  boardName,
  type EmailTokenPurpose,
  issueEmailToken,
  type Repositories,
  type User,
} from "@postmodem/core";
import { negotiate, translator } from "@postmodem/i18n";
import type { AppContext } from "./bootstrap.ts";

const PAGES = {
  "verify-email": { path: "/verify", message: "verify" },
  "reset-password": { path: "/reset", message: "reset" },
  "change-email": { path: "/account", message: "change-email" },
} as const;

/** Queues the message in the same transaction as its token. */
export async function queueAccountMail(
  repos: Repositories,
  ctx: AppContext,
  user: User,
  email: string,
  purpose: EmailTokenPurpose,
  token: string,
  requestLocale: string,
): Promise<void> {
  const page = PAGES[purpose];
  const url = new URL(page.path, ctx.config.publicUrl);
  url.searchParams.set(purpose === "change-email" ? "email-token" : "token", token);
  const locale = negotiate({ requested: user.locale ?? requestLocale, boardDefault: requestLocale });
  const t = translator(locale);
  const vars = { name: user.username, board: ctx.settings.get(boardName), link: url.href };
  await repos.jobs.enqueue("mail.send", {
    to: email,
    subject: t(`mail-${page.message}-subject`, vars),
    text: t(`mail-${page.message}-body`, vars),
    locale,
  });
}

export async function sendAccountMail(
  ctx: AppContext,
  user: User,
  purpose: Exclude<EmailTokenPurpose, "change-email">,
  requestLocale: string,
): Promise<void> {
  await ctx.db.repos.transaction(async (repos) => {
    const current = await repos.users.get(user.id, { forUpdate: true });
    if (
      !user.email ||
      current?.email !== user.email ||
      (current.status !== "active" && current.status !== "pending")
    )
      return;
    const token = await issueEmailToken(repos, user.id, purpose);
    await queueAccountMail(repos, ctx, current, user.email, purpose, token, requestLocale);
  });
  ctx.worker.nudge();
}

/**
 * Visitor-triggered mail is limited per target (account or address) and per IP. Over the limit
 * the caller silently skips sending, answering exactly as if it had sent.
 */
export async function mayMail(
  ctx: AppContext,
  target: string,
  ip: string,
  now = Date.now(),
): Promise<boolean> {
  if ((await ctx.throttles.mail.wait(target, now)) > 0 || (await ctx.throttles.mailIp.wait(ip, now)) > 0)
    return false;
  await ctx.throttles.mail.fail(target, now);
  await ctx.throttles.mailIp.fail(ip, now);
  return true;
}
