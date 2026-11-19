// SPDX-License-Identifier: AGPL-3.0-or-later
// Accounts and sessions (M1 slice 4): registration, sign-in with hash upgrade, server-side
// sessions with idle and absolute expiry. Framework-free; the web layer owns cookies.
import type { Repositories } from "../domain/ports.ts";
import type { Id, Millis, Session, User } from "../domain/types.ts";
import type { PackagePasswordPolicy } from "../packages.ts";
import { hashPassword, newToken, passwordProblem, tokenHash, verifyPassword } from "./passwords.ts";
import { cleanUsername, emailProblem, usernameProblem } from "./usernames.ts";

export interface RegistrationInput {
  username: string;
  email: string;
  password: string;
  acceptRules: boolean;
  locale?: string | null;
}
export interface RegistrationPolicy {
  disallowedUsernames: readonly string[];
  rulesVersion: number;
  /** New accounts start "pending" until their e-mail address is confirmed. */
  verifyEmail: boolean;
  passwordPolicy?: PackagePasswordPolicy;
}
export type RegistrationErrors = Partial<Record<"username" | "email" | "password" | "rules", string>>;

export async function register(
  repos: Repositories,
  policy: RegistrationPolicy,
  input: RegistrationInput,
  now: Millis = Date.now(),
): Promise<{ ok: true; user: User } | { ok: false; errors: RegistrationErrors }> {
  const username = cleanUsername(input.username);
  const email = input.email.trim();
  const errors: RegistrationErrors = {};

  const nameIssue = usernameProblem(username, policy.disallowedUsernames);
  if (nameIssue) errors.username = nameIssue;
  else if (await repos.users.lookalike(username)) errors.username = "taken";

  if (emailProblem(email)) errors.email = "invalid";
  else if (await repos.users.byEmail(email)) errors.email = "taken";

  const pwIssue =
    passwordProblem(input.password, [username, email, email.split("@")[0] ?? ""]) ??
    policy.passwordPolicy?.(input.password, { username, email });
  if (pwIssue) errors.password = pwIssue;
  if (!input.acceptRules) errors.rules = "required";
  if (Object.keys(errors).length) return { ok: false, errors };

  const { scheme, hash } = await hashPassword(input.password);
  try {
    const user = await repos.transaction(async (r) => {
      const u = await r.users.create({
        username,
        email,
        status: policy.verifyEmail ? "pending" : "active",
        createdAt: now,
        locale: input.locale ?? null,
        rulesVersion: policy.rulesVersion,
        rulesAcceptedAt: now,
      });
      await r.credentials.set(u.id, scheme, hash);
      await r.audit.append({
        actorId: u.id,
        action: "user.registered",
        targetType: "user",
        targetId: String(u.id),
        details: {},
      });
      return u;
    });
    return { ok: true, user };
  } catch (e) {
    // Lost a race with a concurrent registration of the same name or address.
    if (await repos.users.lookalike(username)) return { ok: false, errors: { username: "taken" } };
    if (await repos.users.byEmail(email)) return { ok: false, errors: { email: "taken" } };
    throw e;
  }
}

// Verified against when the account doesn't exist, so timing doesn't reveal which names do.
let decoy: Promise<{ scheme: "argon2id"; hash: string }> | undefined;

export type SignInResult =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid" | "inactive" }
  /** Right password, e-mail address not confirmed yet: the caller may offer a new link. */
  | { ok: false; reason: "unverified"; user: User };

/** Sign in with username or e-mail. Legacy and weaker hashes are replaced on success. */
export async function authenticate(
  repos: Repositories,
  login: string,
  password: string,
): Promise<SignInResult> {
  const trimmed = login.trim();
  const user = trimmed.includes("@")
    ? await repos.users.byEmail(trimmed)
    : await repos.users.byUsername(cleanUsername(trimmed));
  const credential = user && (await repos.credentials.get(user.id));
  if (!user || !credential) {
    decoy ??= hashPassword(newToken()) as Promise<{ scheme: "argon2id"; hash: string }>;
    const d = await decoy;
    await verifyPassword(password, d.scheme, d.hash);
    return { ok: false, reason: "invalid" };
  }
  const { ok, needsRehash } = await verifyPassword(password, credential.scheme, credential.hash);
  if (!ok) return { ok: false, reason: "invalid" };
  if (user.status === "pending") return { ok: false, reason: "unverified", user };
  if (user.status !== "active") return { ok: false, reason: "inactive" };
  if (needsRehash) {
    const fresh = await hashPassword(password);
    await repos.credentials.set(user.id, fresh.scheme, fresh.hash);
    if (credential.scheme !== "argon2id")
      await repos.audit.append({
        actorId: user.id,
        action: "user.password-upgraded",
        targetType: "user",
        targetId: String(user.id),
        details: { from: credential.scheme },
      });
  }
  return { ok: true, user };
}

export const SESSION_IDLE_MS = 30 * 24 * 3600_000;
export const SESSION_ABSOLUTE_MS = 90 * 24 * 3600_000;
/** Activity is written at most this often, not on every request. */
export const SESSION_TOUCH_MS = 5 * 60_000;

export async function startSession(
  repos: Repositories,
  userId: Id,
  meta: { userAgent: string; ip: string },
  now: Millis = Date.now(),
): Promise<{ token: string; session: Session }> {
  const token = newToken();
  const session: Session = {
    id: tokenHash(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: Math.min(now + SESSION_IDLE_MS, now + SESSION_ABSOLUTE_MS),
    userAgent: meta.userAgent.slice(0, 300),
    ip: meta.ip.slice(0, 64),
  };
  await repos.sessions.create(session);
  await repos.users.update(userId, { lastSeenAt: now });
  return { token, session };
}

/** The signed-in user for a cookie value, or null (unknown, expired, or account no longer active). */
export async function resolveSession(
  repos: Repositories,
  token: string,
  now: Millis = Date.now(),
  validate?: (session: Session) => boolean,
): Promise<{ session: Session; user: User } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = await repos.sessions.get(tokenHash(token));
  if (!session) return null;
  if (session.expiresAt <= now || session.createdAt + SESSION_ABSOLUTE_MS <= now) {
    await repos.sessions.remove(session.id);
    return null;
  }
  if (validate && !validate(session)) return null;
  const user = await repos.users.get(session.userId);
  if (user?.status !== "active") {
    await repos.sessions.remove(session.id);
    return null;
  }
  if (now - session.lastSeenAt >= SESSION_TOUCH_MS) {
    const expiresAt = Math.min(now + SESSION_IDLE_MS, session.createdAt + SESSION_ABSOLUTE_MS);
    await repos.sessions.touch(session.id, now, expiresAt);
    await repos.users.update(user.id, { lastSeenAt: now });
    Object.assign(session, { lastSeenAt: now, expiresAt });
  }
  return { session, user };
}

export const endSession = (repos: Repositories, token: string) => repos.sessions.remove(tokenHash(token));
