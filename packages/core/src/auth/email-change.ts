// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Repositories } from "../domain/ports.ts";
import type { Id, User } from "../domain/types.ts";
import { issueEmailToken } from "./email-flows.ts";
import { tokenHash, verifyPassword } from "./passwords.ts";
import { emailProblem } from "./usernames.ts";

const PURPOSE = "change-email";

export async function requestEmailChange(
  repos: Repositories,
  userId: Id,
  email: string,
  password: string,
  enqueue: (repos: Repositories, user: User, token: string) => Promise<void>,
): Promise<"invalid" | "wrong" | "taken" | undefined> {
  if (emailProblem(email)) return "invalid";
  const credential = await repos.credentials.get(userId);
  if (!credential || !(await verifyPassword(password, credential.scheme, credential.hash)).ok) return "wrong";
  return repos.transaction(async (r) => {
    const user = await r.users.get(userId, { forUpdate: true });
    const current = await r.credentials.get(userId);
    if (
      user?.status !== "active" ||
      current?.hash !== credential.hash ||
      current.scheme !== credential.scheme
    )
      return "wrong";
    if (await r.users.byEmail(email)) return "taken";
    const token = await issueEmailToken(r, user.id, PURPOSE, Date.now(), email);
    await enqueue(r, user, token);
  });
}

export async function pendingEmailChange(
  repos: Repositories,
  userId: Id,
  token: string,
  now = Date.now(),
): Promise<string | undefined> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  const entry = await repos.emailTokens.peek(tokenHash(token), PURPOSE, now);
  return entry?.userId === userId ? (entry.targetEmail ?? undefined) : undefined;
}

export async function confirmEmailChange(
  repos: Repositories,
  userId: Id,
  token: string,
  banned: (email: string) => boolean,
): Promise<"invalid" | "taken" | "banned" | undefined> {
  let email: string | undefined;
  try {
    return await repos.transaction(async (r) => {
      const user = await r.users.get(userId, { forUpdate: true });
      const now = Date.now();
      email = await pendingEmailChange(r, userId, token, now);
      if (user?.status !== "active" || !email) return "invalid";
      if (banned(email)) return "banned";
      if (await r.users.byEmail(email)) return "taken";
      if ((await r.emailTokens.consume(tokenHash(token), PURPOSE, now)) !== userId) return "invalid";
      await r.users.update(userId, { email });
      await r.emailTokens.revoke(userId, "reset-password", now);
      await r.emailTokens.revoke(userId, "verify-email", now);
      await r.audit.append({
        actorId: userId,
        action: "account.email-changed",
        targetType: "user",
        targetId: String(userId),
        details: {},
      });
    });
  } catch (error) {
    // The unique index resolves a race with another account claiming this address.
    if (email && (await repos.users.byEmail(email))) return "taken";
    throw error;
  }
}
