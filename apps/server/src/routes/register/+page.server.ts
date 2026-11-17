// SPDX-License-Identifier: AGPL-3.0-or-later
// /register (phpBB2: profile.php?mode=register). Account is active immediately until e-mail
// verification arrives with mail (slice 4b).
import {
  boardRules,
  disallowedUsernames,
  register,
  registrationOpen,
  rulesVersion,
  startSession,
} from "@postmodem/core";
import { error, fail, redirect } from "@sveltejs/kit";
import { setSessionCookie } from "#lib/server/auth.ts";
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
    const wait = ctx.throttles.register.wait(ip, now);
    if (wait > 0) return fail(429, { values, errors: {}, throttled: Math.ceil(wait / 60_000) });

    const result = await register(
      ctx.db.repos,
      {
        disallowedUsernames: ctx.settings.get(disallowedUsernames),
        rulesVersion: ctx.settings.get(rulesVersion),
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
    ctx.throttles.register.fail(ip, now);
    const { token } = await startSession(ctx.db.repos, result.user.id, {
      userAgent: request.headers.get("user-agent") ?? "",
      ip,
    });
    setSessionCookie(cookies, ctx.config, token);
    ctx.log.info("registered", { userId: result.user.id });
    redirect(303, "/?welcome=1");
  },
};
