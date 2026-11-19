// SPDX-License-Identifier: AGPL-3.0-or-later
// /register (phpBB2: profile.php?mode=register). With e-mail verification on (the default)
// the account starts pending and a confirmation link is mailed; otherwise it signs in at once.

import { createHash } from "node:crypto";
import {
  boardRules,
  disallowedUsernames,
  findBan,
  register,
  registrationInviteOnly,
  registrationOpen,
  rulesVersion,
  startSession,
  verifyEmailOnRegistration,
} from "@postmodem/core";
import { error, fail, redirect } from "@sveltejs/kit";
import { setSessionCookie } from "#lib/server/auth.ts";
import { encodeAnswer, issueChallenge, verifyAnswer } from "#lib/server/captcha.ts";
import { sendAccountMail } from "#lib/server/emails.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

const hashCode = (code: string) => createHash("sha256").update(code.trim()).digest("hex");
const captchaSecret = (locals: App.Locals) => `${locals.ctx.config.secretKey}:captcha`;

/** With invite-only registration: the usable invite from ?invite=…, or null. */
async function inviteFor({ locals, url }: Pick<RequestEvent, "locals" | "url">) {
  if (!locals.ctx.settings.get(registrationInviteOnly)) return undefined;
  const code = url.searchParams.get("invite") ?? "";
  return code ? ((await locals.ctx.db.repos.invites.usable(hashCode(code), Date.now())) ?? null) : null;
}

export const load: PageServerLoad = async (event) => {
  const { locals } = event;
  if (!locals.ctx.settings.get(registrationOpen)) error(404, "Not found");
  if (locals.user) redirect(303, "/");
  const invite = await inviteFor(event);
  // The proof-of-work challenge; the hidden field starts with the no-JavaScript answer.
  const challenge = issueChallenge(captchaSecret(locals));
  return {
    rules: locals.ctx.settings.get(boardRules),
    inviteOnly: invite !== undefined,
    inviteValid: invite !== undefined && invite !== null,
    challenge,
    answer: encodeAnswer(challenge, null),
  };
};

export const actions: Actions = {
  default: async ({ request, cookies, locals, getClientAddress, url }) => {
    const { ctx } = locals;
    if (!ctx.settings.get(registrationOpen)) error(404, "Not found");
    const form = await request.formData();
    const values = {
      username: String(form.get("username") ?? "").slice(0, 100),
      email: String(form.get("email") ?? "").slice(0, 300),
    };
    const ip = getClientAddress();
    const now = Date.now();
    const invite = await inviteFor({ locals, url });
    if (invite === null) return fail(403, { values, errors: { invite: "invalid" }, throttled: 0 });
    const captcha = await verifyAnswer(
      captchaSecret(locals),
      form.get("captcha")?.toString() ?? null,
      ctx.db.repos.throttle,
      now,
    );
    if (captcha !== "ok") return fail(400, { values, errors: { captcha }, throttled: 0 });
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
        passwordPolicy: ctx.packages.passwordPolicy,
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
    if (invite) {
      await ctx.db.repos.invites.consume(invite.id);
      await ctx.db.repos.audit.append({
        actorId: result.user.id,
        action: "invite.used",
        targetType: "invite",
        targetId: String(invite.id),
        details: {},
      });
    }

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
