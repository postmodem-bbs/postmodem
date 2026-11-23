// SPDX-License-Identifier: AGPL-3.0-or-later
// E-mailing a member through the board (#132), phpBB2's profile.php?mode=email. The board sends
// the message; neither member's address is shown to the other, and replies go by private
// message. Only members who allow it can be written to, and new members can't write yet, as
// with private messages.
import type { Permissions } from "./core-permissions.ts";
import { cleanTitle, TITLE_MAX } from "./posting.ts";
import type { User } from "./types.ts";

export const MEMBER_MAIL_MAX = 5000;

export type MemberMailProblem =
  | "disabled"
  | "sign-in"
  | "forbidden"
  | "recipient"
  | "self"
  | "new-member"
  | "subject-missing"
  | "subject-long"
  | "body-missing"
  | "body-long";

/** Whether `recipient` can be e-mailed through the board at all, by anyone signed in. */
export const reachableByMail = (recipient: User, boardAllows: boolean) =>
  boardAllows &&
  recipient.allowEmail &&
  !!recipient.email &&
  recipient.status === "active" &&
  recipient.origin === "local";

/** The message as it will be sent, or why it can't be. */
export function memberMailProblem(
  sender: User | null,
  recipient: User | undefined,
  perms: Permissions,
  input: { subject: string; body: string },
  rules: { boardAllows: boolean; newMemberPosts?: number },
): MemberMailProblem | { subject: string; body: string } {
  if (!rules.boardAllows) return "disabled";
  if (!sender) return "sign-in";
  if (sender.status !== "active" || !perms.can("pm.send", null)) return "forbidden";
  if (!recipient || !reachableByMail(recipient, true)) return "recipient";
  if (recipient.id === sender.id) return "self";
  if (rules.newMemberPosts && sender.postCount < rules.newMemberPosts && !perms.can("moderate.edit", null))
    return "new-member";
  const subject = cleanTitle(input.subject);
  if (!subject) return "subject-missing";
  if ([...subject].length > TITLE_MAX) return "subject-long";
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (!body) return "body-missing";
  if ([...body].length > MEMBER_MAIL_MAX) return "body-long";
  return { subject, body };
}
