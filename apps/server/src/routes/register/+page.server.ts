// SPDX-License-Identifier: AGPL-3.0-or-later
// /register (phpBB2: profile.php?mode=register). With e-mail verification on (the default)
// the account starts pending and a confirmation link is mailed; otherwise it signs in at once.
import {
  boardRules,
  disallowedUsernames,
  findBan,
  register,
  registrationOpen,
  rulesVersion,
  startSession,
  verifyEmailOnRegistration,
} from "@postmodem/core";
import { error, fail, redirect } from "@sveltejs/kit";
import { setSessionCookie } from "#lib/server/auth.ts";
import { sendAccountMail } from "#lib/server/emails.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.ctx.settings.get(registrationOpen)) error(404, "Not found");
  if (locals.user) redirect(303, "/");
  return { rules: locals.ctx.settings.get(boardRules) };
};

export const actions: Actions = {
  default: async ({ request, cookies, locals, getClientAddress }) => {
    const { ctx } = locals;
    if (!ctx.settings.get(registrationOpen)) error(404, "Not found");
    const form = await request.formData();
    const values = {
      username: String(form.get("username") ?? "").slice(0, 100),
      email: String(form.get("email") ?? "").slice(0, 300),
    };
    const ip = getClientAddress();
    const now = Date.now();
    const wait = await ctx.throttles.register.wait(ip, now);
    if (wait > 0) return fail(429, { values, errors: {}, throttled: Math.ceil(wait / 60_000) });

    // phpBB2's banlist: banned addresses (and wildcards like *@spam.example) can't register.
    if (findBan(await ctx.activeBans(), { email: values.email.trim(), ip }))
      return fail(403, { values, errors: { email: "banned" } });

    const result = await register(
      ctx.db.repos,
      {
        disallowedUsernames: ctx.settings.get(disallowedUsernames),
        rulesVersion: ctx.settings.get(rulesVersion),
        verifyEmail: ctx.settings.get(verifyEmailOnRegistration),
      },
      {
        ...values,
        password: String(form.get("password") ?? ""),
        acceptRules: form.get("rules") === "on",
        locale: locals.locale,
      },
      now,
    );
    if (!result.ok) return fail(400, { values, errors: result.errors, throttled: 0 });

    // Every successful registration counts, so one address can't mint accounts in bulk.
    await ctx.throttles.register.fail(ip, now);
    ctx.log.info("registered", { userId: result.user.id, status: result.user.status });
    if (result.user.status === "pending") {
      await sendAccountMail(ctx, result.user, "verify-email", locals.locale);
      redirect(303, "/verify?sent=1");
    }
    const { token } = await startSession(ctx.db.repos, result.user.id, {
      userAgent: request.headers.get("user-agent") ?? "",
      ip,
    });
    setSessionCookie(cookies, ctx.config, token);
    redirect(303, "/?notice=welcome");
  },
};
