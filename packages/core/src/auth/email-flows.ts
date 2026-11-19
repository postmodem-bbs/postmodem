// SPDX-License-Identifier: AGPL-3.0-or-later
// E-mail address verification and password reset (M1 slice 4b). Links carry a random token;
// the database keeps only its hash, and each token works once.
import type { Repositories } from "../domain/ports.ts";
import type { EmailTokenPurpose, Id, Millis, User } from "../domain/types.ts";
import type { PackagePasswordPolicy } from "../packages.ts";
import { hashPassword, newToken, passwordProblem, tokenHash } from "./passwords.ts";

export const TOKEN_TTL: Record<EmailTokenPurpose, Millis> = {
  "verify-email": 7 * 24 * 3600_000,
  "reset-password": 3600_000,
};

/** Issues a fresh token, invalidating older ones of the same purpose. Returns the raw token. */
export async function issueEmailToken(
  repos: Repositories,
  userId: Id,
  purpose: EmailTokenPurpose,
  now: Millis = Date.now(),
): Promise<string> {
  const token = newToken();
  await repos.emailTokens.revoke(userId, purpose, now);
  await repos.emailTokens.create({
    userId,
    purpose,
    tokenHash: tokenHash(token),
    expiresAt: now + TOKEN_TTL[purpose],
    createdAt: now,
  });
  return token;
}

const wellFormed = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

/** Whether a link is still good, without using it (for the confirmation page a GET shows). */
export async function checkEmailToken(
  repos: Repositories,
  token: string,
  purpose: EmailTokenPurpose,
  now: Millis = Date.now(),
): Promise<User | undefined> {
  if (!wellFormed(token)) return undefined;
  const userId = await repos.emailTokens.peek(tokenHash(token), purpose, now);
  return userId === undefined ? undefined : repos.users.get(userId);
}

/** Confirms the address: a pending account becomes active. */
export async function verifyEmail(
  repos: Repositories,
  token: string,
  now: Millis = Date.now(),
): Promise<User | undefined> {
  if (!wellFormed(token)) return undefined;
  const userId = await repos.emailTokens.consume(tokenHash(token), "verify-email", now);
  const user = userId === undefined ? undefined : await repos.users.get(userId);
  if (!user || (user.status !== "pending" && user.status !== "active")) return undefined;
  if (user.status === "pending") {
    await repos.audit.append({
      actorId: user.id,
      action: "user.email-verified",
      targetType: "user",
      targetId: String(user.id),
      details: {},
    });
    return repos.users.update(user.id, { status: "active" });
  }
  return user;
}

export type ResetResult = { ok: true; user: User } | { ok: false; error: string };

/**
 * Sets a new password from a reset link. Every session of the user ends, and other reset
 * links stop working. A pending account becomes active: the link proves the mailbox.
 */
export async function resetPassword(
  repos: Repositories,
  token: string,
  password: string,
  now: Millis = Date.now(),
  policy?: PackagePasswordPolicy,
): Promise<ResetResult> {
  const holder = await checkEmailToken(repos, token, "reset-password", now);
  if (!holder || (holder.status !== "pending" && holder.status !== "active"))
    return { ok: false, error: "invalid-link" };
  const problem =
    passwordProblem(password, [holder.username, holder.email ?? ""]) ?? policy?.(password, holder);
  if (problem) return { ok: false, error: problem }; // the link stays usable for another try
  const userId = await repos.emailTokens.consume(tokenHash(token), "reset-password", now);
  if (userId !== holder.id) return { ok: false, error: "invalid-link" };

  const { scheme, hash } = await hashPassword(password);
  await repos.credentials.set(userId, scheme, hash);
  await repos.emailTokens.revoke(userId, "reset-password", now);
  await repos.sessions.removeForUser(userId);
  const user = holder.status === "pending" ? await repos.users.update(userId, { status: "active" }) : holder;
  await repos.audit.append({
    actorId: userId,
    action: "user.password-reset",
    targetType: "user",
    targetId: String(userId),
    details: {},
  });
  return { ok: true, user };
}
