// SPDX-License-Identifier: AGPL-3.0-or-later
// /login.php — phpBB2's URL. Named actions: ?/login, ?/logout, ?/logoutAll. Sign-out is POST
// only (phpBB2's GET ?logout=true was a CSRF hole); SvelteKit rejects cross-origin form posts.
import { authenticate, endSession, nameKey, startSession } from "@postmodem/core";
import { fail, redirect } from "@sveltejs/kit";
import { clearSessionCookie, sessionCookieName, setSessionCookie } from "#lib/server/auth.ts";
import { mayMail, sendAccountMail } from "#lib/server/emails.ts";
import { safeReturnPath } from "#lib/server/preferences.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => ({
  signedInAs: locals.user?.username ?? null,
  redirectTo: safeReturnPath(url.searchParams.get("redirect")),
  otherSessions: locals.user
    ? (await locals.ctx.db.repos.sessions.listForUser(locals.user.id)).length - 1
    : 0,
});

export const actions: Actions = {
  login: async ({ request, cookies, locals, getClientAddress }) => {
    const { ctx } = locals;
    const form = await request.formData();
    const login = String(form.get("login") ?? "").slice(0, 254);
    const password = String(form.get("password") ?? "");
    const redirectTo = safeReturnPath(String(form.get("redirect") ?? "/"));
    const now = Date.now();
    const accountKey = nameKey(login);
    const ipKey = getClientAddress();

    const wait = Math.max(
      await ctx.throttles.login.wait(accountKey, now),
      await ctx.throttles.loginIp.wait(ipKey, now),
    );
    if (wait > 0)
      return fail(429, { login, redirectTo, error: "throttled", seconds: Math.ceil(wait / 1000) });

    const result = await authenticate(ctx.db.repos, login, password);
    if (!result.ok && result.reason === "unverified") {
      // Right password: not a failure, but no session until the address is confirmed.
      return fail(403, { login, redirectTo, error: "unverified", seconds: 0 });
    }
    if (!result.ok) {
      await ctx.throttles.login.fail(accountKey, now);
      await ctx.throttles.loginIp.fail(ipKey, now);
      return fail(400, { login, redirectTo, error: result.reason, seconds: 0 });
    }
    await ctx.throttles.login.reset(accountKey);

    // Session rotation: a session id that existed before sign-in never survives it.
    const previous = cookies.get(sessionCookieName(ctx.config));
    if (previous) await endSession(ctx.db.repos, previous);
    const { token } = await startSession(ctx.db.repos, result.user.id, {
      userAgent: request.headers.get("user-agent") ?? "",
      ip: ipKey,
    });
    setSessionCookie(cookies, ctx.config, token);
    ctx.log.info("signed in", { userId: result.user.id });
    redirect(303, redirectTo);
  },

  /** New confirmation link. Same answer whatever the account's state, so it reveals nothing. */
  resend: async ({ request, locals, getClientAddress }) => {
    const { ctx } = locals;
    const login = String((await request.formData()).get("login") ?? "").slice(0, 254);
    const user = login.includes("@")
      ? await ctx.db.repos.users.byEmail(login)
      : await ctx.db.repos.users.byUsername(login);
    if (user?.status === "pending" && (await mayMail(ctx, String(user.id), getClientAddress())))
      await sendAccountMail(ctx, user, "verify-email", locals.locale);
    return { resent: true, login };
  },

  logout: async ({ cookies, locals }) => {
    const token = cookies.get(sessionCookieName(locals.ctx.config));
    if (token) await endSession(locals.ctx.db.repos, token);
    clearSessionCookie(cookies, locals.ctx.config);
    redirect(303, "/");
  },

  logoutAll: async ({ cookies, locals }) => {
    if (locals.user) {
      const ended = await locals.ctx.db.repos.sessions.removeForUser(locals.user.id);
      locals.ctx.log.info("signed out everywhere", { userId: locals.user.id, sessions: ended });
    }
    clearSessionCookie(cookies, locals.ctx.config);
    redirect(303, "/");
  },
};
