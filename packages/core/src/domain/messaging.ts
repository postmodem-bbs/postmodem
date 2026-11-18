// SPDX-License-Identifier: AGPL-3.0-or-later
// Private messages (M2 slice 5, vanilla phpBB2 privmsg.php): one row per message, an inbox
// with a size limit (phpBB2's max_inbox_privmsgs), a sent folder, each side deleting its own
// view. Sending needs `pm.send` (members have it); the posting limit counts messages too
// (the web layer applies it).
import type { Permissions } from "./core-permissions.ts";
import type { Repositories } from "./ports.ts";
import { bodyProblem, cleanTitle, TITLE_MAX } from "./posting.ts";
import type { Id, Millis, PrivateMessage, User } from "./types.ts";

export type MessageProblem =
  | "sign-in"
  | "forbidden"
  | "recipient-unknown"
  | "inbox-full"
  | "subject-missing"
  | "subject-long"
  | "body-missing"
  | "body-long";

export type SendResult =
  | { ok: true; message: PrivateMessage; recipient: User }
  | { ok: false; problem: MessageProblem };

export async function sendMessage(
  repos: Repositories,
  perms: Permissions,
  sender: User | null,
  input: { to: string; subject: string; source: string },
  rules: { maxLength: number; inboxLimit: number; now?: Millis },
): Promise<SendResult> {
  if (!sender) return { ok: false, problem: "sign-in" };
  if (sender.status !== "active" || !perms.can("pm.send", null)) return { ok: false, problem: "forbidden" };
  const recipient = await repos.users.byUsername(input.to.trim());
  if (!recipient || recipient.status !== "active" || recipient.origin !== "local")
    return { ok: false, problem: "recipient-unknown" };
  const subject = cleanTitle(input.subject);
  if (!subject) return { ok: false, problem: "subject-missing" };
  if ([...subject].length > TITLE_MAX) return { ok: false, problem: "subject-long" };
  const body = bodyProblem(input.source, rules.maxLength);
  if (body) return { ok: false, problem: body as MessageProblem };
  if (rules.inboxLimit && (await repos.messages.inboxCount(recipient.id)) >= rules.inboxLimit)
    return { ok: false, problem: "inbox-full" };
  const message = await repos.messages.create({
    senderId: sender.id,
    recipientId: recipient.id,
    subject,
    source: input.source,
    createdAt: rules.now ?? Date.now(),
  });
  return { ok: true, message, recipient };
}

/** A message the viewer may read (their own, not deleted on their side); marks it read. */
export async function openMessage(repos: Repositories, viewer: User, id: Id, now = Date.now()) {
  const m = await repos.messages.get(id);
  if (!m) return null;
  const mine =
    (m.recipientId === viewer.id && !m.recipientDeleted) || (m.senderId === viewer.id && !m.senderDeleted);
  if (!mine) return null;
  if (m.recipientId === viewer.id && m.readAt === null) {
    await repos.messages.markRead(m.id, now);
    return { ...m, readAt: now };
  }
  return m;
}

/** A message from the board itself (e.g. "your report was closed"); skips limits and checks. */
export function systemMessage(
  repos: Repositories,
  input: { senderId: Id | null; recipientId: Id; subject: string; source: string },
) {
  return repos.messages.create({
    ...input,
    subject: cleanTitle(input.subject).slice(0, TITLE_MAX),
    createdAt: Date.now(),
  });
}
