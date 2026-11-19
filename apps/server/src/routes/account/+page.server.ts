// SPDX-License-Identifier: AGPL-3.0-or-later
// /account — a member's own settings (phpBB2's profile.php?mode=editprofile, which redirects
// here): profile fields, signature, notifications, credentials and account deletion.
import {
  confirmEmailChange,
  defaultLocale,
  deleteAccount,
  deletedMemberPosts,
  emailProblem,
  findBan,
  hashPassword,
  maxPostLength,
  PASSWORD_MIN,
  passwordProblem,
  pendingEmailChange,
  requestEmailChange,
  verifyPassword,
} from "@postmodem/core";
import { translator } from "@postmodem/i18n";
import { fail, redirect } from "@sveltejs/kit";
import { clearSessionCookie } from "#lib/server/auth.ts";
import { mayMail, queueAccountMail } from "#lib/server/emails.ts";
import { readerOf } from "#lib/server/reader.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

const SIGNATURE_MAX = 1000;

function me({ locals, url }: Pick<RequestEvent, "locals" | "url">) {
  if (!locals.user) redirect(303, `/login.php?redirect=${encodeURIComponent(url.pathname + url.search)}`);
  return locals.user;
}

export const load: PageServerLoad = async (event) => {
  // Re-read: after a save, locals.user is still the copy from before it.
  const user = (await event.locals.ctx.db.repos.users.get(me(event).id))!;
  const token = event.url.searchParams.get("email-token");
  const targetEmail =
    token === null ? undefined : await pendingEmailChange(event.locals.ctx.db.repos, user.id, token);
  if (token !== null) event.setHeaders({ "cache-control": "no-store" });
  return {
    emailConfirmation: token === null ? null : { token: targetEmail ? token : null, targetEmail },
    emailChanged: event.url.searchParams.has("email-changed"),
    profile: {
      username: user.username,
      email: user.email ?? "",
      location: user.location,
      website: user.website,
      signature: user.signatureSource,
      notifyPm: user.notifyPm,
      autoWatch: user.autoWatch,
    },
    signatureHtml: user.signatureSource
      ? await event.locals.ctx.renderer.preview(user.signatureSource, readerOf(event.locals))
      : "",
    passwordMin: PASSWORD_MIN,
    postsKept: event.locals.ctx.settings.get(deletedMemberPosts) === "keep",
    signatureMax: Math.min(SIGNATURE_MAX, event.locals.ctx.settings.get(maxPostLength)),
  };
};

export const actions: Actions = {
  profile: async (event) => {
    const user = me(event);
    const form = await event.request.formData();
    const website = String(form.get("website") ?? "")
      .trim()
      .slice(0, 200);
    const signature = String(form.get("signature") ?? "").replace(/\r\n/g, "\n");
    const errors: Record<string, string> = {};
    if (website && !/^https?:\/\/[^\s"'<>]+$/i.test(website)) errors.website = "invalid";
    if ([...signature].length > SIGNATURE_MAX) errors.signature = "long";
    const values = {
      location: String(form.get("location") ?? "")
        .trim()
        .slice(0, 100),
      website,
      signature,
    };
    if (Object.keys(errors).length) return fail(400, { section: "profile", errors, values });
    await event.locals.ctx.db.repos.users.update(user.id, {
      location: values.location,
      website,
      signatureSource: signature,
      notifyPm: form.get("notifyPm") === "on",
      autoWatch: form.get("autoWatch") === "on",
    });
    return { section: "profile", saved: true };
  },
  password: async (event) => {
    const user = me(event);
    const { repos } = event.locals.ctx.db;
    const form = await event.request.formData();
    const current = String(form.get("current") ?? "");
    const next = String(form.get("password") ?? "");
    const credential = await repos.credentials.get(user.id);
    if (!credential || !(await verifyPassword(current, credential.scheme, credential.hash)).ok)
      return fail(400, { section: "password", errors: { current: "wrong" } });
    const problem = passwordProblem(next, [user.username, user.email ?? ""]);
    if (problem) return fail(400, { section: "password", errors: { password: problem } });
    const { scheme, hash } = await hashPassword(next);
    const saved = await repos.transaction(async (r) => {
      const holder = await r.users.get(user.id, { forUpdate: true });
      const latest = await r.credentials.get(user.id);
      if (
        holder?.status !== "active" ||
        latest?.hash !== credential.hash ||
        latest.scheme !== credential.scheme
      )
        return false;
      await r.credentials.set(user.id, scheme, hash);
      await r.emailTokens.revoke(user.id, "change-email", Date.now());
      await r.sessions.removeForUser(user.id, event.locals.session?.id);
      await r.audit.append({
        actorId: user.id,
        action: "account.password-changed",
        targetType: "user",
        targetId: String(user.id),
        details: {},
      });
      return true;
    });
    if (!saved) return fail(400, { section: "password", errors: { current: "wrong" } });
    return { section: "password", saved: true };
  },
  email: async (event) => {
    const user = me(event);
    const { ctx, locale } = event.locals;
    const form = await event.request.formData();
    const email = String(form.get("email") ?? "").trim();
    const emailValue = email.slice(0, 254);
    if (emailProblem(email)) return fail(400, { section: "email", emailValue, emailError: "invalid" });
    if (findBan(await ctx.activeBans(), { email }))
      return fail(403, { section: "email", emailValue, emailError: "banned" });
    if (!(await mayMail(ctx, `change-email:${user.id}`, event.getClientAddress())))
      return fail(429, { section: "email", emailValue, emailError: "throttled" });
    const result = await requestEmailChange(
      ctx.db.repos,
      user.id,
      email,
      String(form.get("current") ?? ""),
      (repos, holder, token) => queueAccountMail(repos, ctx, holder, email, "change-email", token, locale),
    );
    if (result) return fail(400, { section: "email", emailValue, emailError: result });
    ctx.worker.nudge();
    return { section: "email", sent: true };
  },
  confirmEmail: async (event) => {
    const user = me(event);
    const { ctx } = event.locals;
    const token = String((await event.request.formData()).get("token") ?? "");
    const bans = await ctx.activeBans();
    const result = await confirmEmailChange(
      ctx.db.repos,
      user.id,
      token,
      (email) => !!findBan(bans, { email }),
    );
    if (result) return fail(400, { section: "confirmEmail", emailError: result });
    redirect(303, "/account?email-changed");
  },
  delete: async (event) => {
    const user = me(event);
    const { ctx } = event.locals;
    const form = await event.request.formData();
    const credential = await ctx.db.repos.credentials.get(user.id);
    if (
      !credential ||
      !(await verifyPassword(String(form.get("password") ?? ""), credential.scheme, credential.hash)).ok
    )
      return fail(400, { section: "delete", errors: { deletePassword: "wrong" } });
    if (form.get("confirm") !== "on")
      return fail(400, { section: "delete", errors: { confirm: "required" } });
    // Posts are credited to "Deleted user" in the board's language, like phpBB2 stored a name.
    const deletedName = translator(ctx.settings.get(defaultLocale))("deleted-user");
    await deleteAccount(ctx.db.repos, user, { posts: ctx.settings.get(deletedMemberPosts), deletedName });
    clearSessionCookie(event.cookies, ctx.config);
    ctx.log.info("account deleted", { userId: user.id });
    redirect(303, "/?notice=deleted");
  },
};
