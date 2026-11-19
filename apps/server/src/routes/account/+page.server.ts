// SPDX-License-Identifier: AGPL-3.0-or-later
// /account — a member's own settings (phpBB2's profile.php?mode=editprofile, which redirects
// here): profile fields, signature, notifications, and changing the password. Changing the
// e-mail address needs a confirmation round trip and arrives later.
import {
  defaultLocale,
  deleteAccount,
  deletedMemberPosts,
  hashPassword,
  maxPostLength,
  PASSWORD_MIN,
  passwordProblem,
  verifyPassword,
} from "@postmodem/core";
import { translator } from "@postmodem/i18n";
import { fail, redirect } from "@sveltejs/kit";
import { clearSessionCookie } from "#lib/server/auth.ts";
import { readerOf } from "#lib/server/reader.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

const SIGNATURE_MAX = 1000;

function me({ locals }: Pick<RequestEvent, "locals">) {
  if (!locals.user) redirect(303, "/login.php?redirect=%2Faccount");
  return locals.user;
}

export const load: PageServerLoad = async (event) => {
  // Re-read: after a save, locals.user is still the copy from before it.
  const user = (await event.locals.ctx.db.repos.users.get(me(event).id))!;
  return {
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
    await repos.credentials.set(user.id, scheme, hash);
    // A new password signs out every other device, as a reset does.
    await repos.sessions.removeForUser(user.id, event.locals.session?.id);
    await repos.audit.append({
      actorId: user.id,
      action: "account.password-changed",
      targetType: "user",
      targetId: String(user.id),
      details: {},
    });
    return { section: "password", saved: true };
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
    // The platform services' data about the member goes too (preferences, user fields, and
    // documents they wrote; posts stay or go by the board's setting above).
    await ctx.db.platform.preferences.deleteAll(user.id);
    await ctx.platform.fields.removeEntity("user", user.id);
    await ctx.db.platform.docs.removeByAuthor(user.id);
    clearSessionCookie(event.cookies, ctx.config);
    ctx.log.info("account deleted", { userId: user.id });
    redirect(303, "/?notice=deleted");
  },
};
