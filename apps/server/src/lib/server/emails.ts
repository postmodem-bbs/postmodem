// SPDX-License-Identifier: AGPL-3.0-or-later
// Account e-mails, rendered in the recipient's language at the moment they're queued.
import { boardName, type EmailTokenPurpose, issueEmailToken, type User } from "@postmodem/core";
import { negotiate, translator } from "@postmodem/i18n";
import type { AppContext } from "./bootstrap.ts";

const PAGES: Record<EmailTokenPurpose, { path: string; message: "verify" | "reset" }> = {
  "verify-email": { path: "/verify", message: "verify" },
  "reset-password": { path: "/reset", message: "reset" },
};

/** Issues a one-time link for the user and queues the e-mail carrying it. */
export async function sendAccountMail(
  ctx: AppContext,
  user: User,
  purpose: EmailTokenPurpose,
  requestLocale: string,
): Promise<void> {
  if (!user.email) return;
  const token = await issueEmailToken(ctx.db.repos, user.id, purpose);
  const page = PAGES[purpose];
  const link = new URL(`${page.path}?token=${token}`, ctx.config.publicUrl).href;
  const locale = negotiate({ requested: user.locale ?? requestLocale, boardDefault: requestLocale });
  const t = translator(locale);
  const vars = { name: user.username, board: ctx.settings.get(boardName), link };
  await ctx.sendMail({
    to: user.email,
    subject: t(`mail-${page.message}-subject`, vars),
    text: t(`mail-${page.message}-body`, vars),
    locale,
  });
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
