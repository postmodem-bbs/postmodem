// SPDX-License-Identifier: AGPL-3.0-or-later
// /reset (phpBB2: profile.php?mode=sendpassword). Without a token: ask for the address and
// mail a link, answering the same whether or not an account uses it. With a token: choose a
// new password. phpBB2 mailed a new plain-text password instead; we never do.
import { checkEmailToken, emailProblem, resetPassword, startSession } from "@postmodem/core";
import { fail, redirect } from "@sveltejs/kit";
import { setSessionCookie } from "#lib/server/auth.ts";
import { mayMail, sendAccountMail } from "#lib/server/emails.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, locals }) => {
  const token = url.searchParams.get("token");
  if (!token) return { token: null, name: null, invalid: false };
  const user = await checkEmailToken(locals.ctx.db.repos, token, "reset-password");
  return { token: user ? token : null, name: user?.username ?? null, invalid: !user };
};

export const actions: Actions = {
  request: async ({ request, locals, getClientAddress }) => {
    const { ctx } = locals;
    const email = String((await request.formData()).get("email") ?? "")
      .trim()
      .slice(0, 254);
    if (emailProblem(email)) return fail(400, { email, error: "invalid-email" });
    const ip = getClientAddress();
    if ((await ctx.throttles.mailIp.wait(ip, Date.now())) > 0)
      return fail(429, { email, error: "throttled" });
    const user = await ctx.db.repos.users.byEmail(email);
    const usable = user && (user.status === "active" || user.status === "pending");
    if (usable && (await mayMail(ctx, `reset:${user.id}`, ip)))
      await sendAccountMail(ctx, user, "reset-password", locals.locale);
    return { requested: true };
  },

  set: async ({ request, cookies, locals, getClientAddress }) => {
    const { ctx } = locals;
    const form = await request.formData();
    const token = String(form.get("token") ?? "");
    const result = await resetPassword(ctx.db.repos, token, String(form.get("password") ?? ""));
    if (!result.ok) return fail(400, { error: result.error });
    const { token: session } = await startSession(ctx.db.repos, result.user.id, {
      userAgent: request.headers.get("user-agent") ?? "",
      ip: getClientAddress(),
    });
    setSessionCookie(cookies, ctx.config, session);
    ctx.log.info("password reset", { userId: result.user.id });
    redirect(303, "/?notice=reset");
  },
};
