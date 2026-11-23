// SPDX-License-Identifier: AGPL-3.0-or-later
// /account — a member's own settings (phpBB2's profile.php?mode=editprofile, which redirects
// here): profile fields, signature, notifications, time and language, credentials and account
// deletion.
import {
  boardDateFormat,
  boardTimeZone,
  confirmEmailChange,
  DATE_FORMATS,
  defaultLocale,
  deleteAccount,
  deletedMemberPosts,
  emailProblem,
  findBan,
  hashPassword,
  isTimeZone,
  maxPostLength,
  memberEmail,
  PASSWORD_MIN,
  passwordProblem,
  pendingEmailChange,
  requestEmailChange,
  TIME_ZONES,
  verifyPassword,
} from "@postmodem/core";
import { SUPPORTED, translator } from "@postmodem/i18n";
import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import { formatDateTime } from "#lib/format.ts";
import { avatarActions, avatarSection } from "#lib/server/account-avatar.ts";
import { clearSessionCookie } from "#lib/server/auth.ts";
import { releaseAvatar } from "#lib/server/avatars.ts";
import { mayMail, queueAccountMail } from "#lib/server/emails.ts";
import { dateFormat, language } from "#lib/server/platform.ts";
import { readerOf } from "#lib/server/reader.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

const SIGNATURE_MAX = 1000;

/**
 * The Notifications section's preferences (the core's, then packages'), as the form shows
 * them: a checkbox for a boolean, a choice of options for an enum.
 */
async function notificationChoices(ctx: App.Locals["ctx"], userId: number) {
  const prefs = await ctx.platform.preferences.forReader(userId, undefined);
  return ctx.platform.preferences.section("notifications").map((def) => {
    const label = `pref-${def.key.replace(/\./g, "-")}`;
    const options = def.schema instanceof z.ZodEnum ? (def.schema.options as string[]) : null;
    return { key: def.key, label, value: prefs.get(def) as string | boolean, options };
  });
}

/** Time zones as the picker shows them: grouped by region ("Europe/Warsaw" under Europe). */
const ZONE_GROUPS = (() => {
  const groups = new Map<string, string[]>();
  for (const zone of TIME_ZONES) {
    const region = zone.includes("/") ? zone.slice(0, zone.indexOf("/")) : "";
    groups.set(region, [...(groups.get(region) ?? []), zone]);
  }
  return [...groups].map(([region, zones]) => ({ region, zones }));
})();

/** phpBB2's date, time zone and language choices (#129), with an example of each date format. */
async function regionalChoices(event: Pick<RequestEvent, "locals">, timezone: string | null) {
  const { locals } = event;
  const { settings, platform } = locals.ctx;
  const prefs = await platform.preferences.forReader(locals.user!.id, undefined);
  const zone = isTimeZone(timezone) ? timezone : settings.get(boardTimeZone);
  const now = Date.now();
  const example = (style: (typeof DATE_FORMATS)[number]) =>
    formatDateTime(now, { locale: locals.locale, timeZone: zone, style });
  return {
    language: prefs.get(language),
    languages: [...SUPPORTED],
    timezone: isTimeZone(timezone) ? timezone : "",
    boardTimeZone: settings.get(boardTimeZone),
    zoneGroups: ZONE_GROUPS,
    dateFormat: prefs.get(dateFormat),
    boardDateExample: example(settings.get(boardDateFormat)),
    dateExamples: DATE_FORMATS.map((style) => ({ style, example: example(style) })),
  };
}

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
      allowEmail: user.allowEmail,
    },
    memberEmail: event.locals.ctx.settings.get(memberEmail),
    notifications: await notificationChoices(event.locals.ctx, user.id),
    regional: await regionalChoices(event, user.timezone),
    avatar: await avatarSection(event, user.avatar),
    signatureHtml: user.signatureSource
      ? await event.locals.ctx.renderer.preview(user.signatureSource, readerOf(event.locals))
      : "",
    passwordMin: PASSWORD_MIN,
    postsKept: event.locals.ctx.settings.get(deletedMemberPosts) === "keep",
    signatureMax: Math.min(SIGNATURE_MAX, event.locals.ctx.settings.get(maxPostLength)),
  };
};

export const actions: Actions = {
  avatarUpload: async (event) => {
    me(event);
    return avatarActions.avatarUpload(event);
  },
  avatarGallery: async (event) => {
    me(event);
    return avatarActions.avatarGallery(event);
  },
  avatarRemove: async (event) => {
    me(event);
    return avatarActions.avatarRemove(event);
  },
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
    const { preferences } = event.locals.ctx.platform;
    const chosen = preferences.section("notifications").map((def) => ({
      def,
      value: typeof def.default === "boolean" ? form.get(def.key) === "on" : String(form.get(def.key) ?? ""),
    }));
    for (const { def, value } of chosen)
      if (!def.schema.safeParse(value).success) errors[def.key] = "invalid";
    if (Object.keys(errors).length) return fail(400, { section: "profile", errors, values });
    for (const { def, value } of chosen) await preferences.set(user.id, def.key, value);
    await event.locals.ctx.db.repos.users.update(user.id, {
      location: values.location,
      website,
      signatureSource: signature,
      notifyPm: form.get("notifyPm") === "on",
      autoWatch: form.get("autoWatch") === "on",
      allowEmail: form.get("allowEmail") === "on",
    });
    return { section: "profile", saved: true };
  },
  regional: async (event) => {
    const user = me(event);
    const form = await event.request.formData();
    const lang = String(form.get("language") ?? "");
    const zone = String(form.get("timezone") ?? "");
    const style = String(form.get("dateFormat") ?? "");
    const errors: Record<string, string> = {};
    if (!language.schema.safeParse(lang).success) errors.language = "invalid";
    if (zone !== "" && !isTimeZone(zone)) errors.timezone = "invalid";
    if (!dateFormat.schema.safeParse(style).success) errors.dateFormat = "invalid";
    if (Object.keys(errors).length) return fail(400, { section: "regional", errors });
    const { preferences } = event.locals.ctx.platform;
    await preferences.set(user.id, language.key, lang);
    await preferences.set(user.id, dateFormat.key, style);
    // Empty: the board's time zone, which follows the board if an admin changes it.
    await event.locals.ctx.db.repos.users.update(user.id, { timezone: zone || null });
    return { section: "regional", saved: true };
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
    const problem =
      passwordProblem(next, [user.username, user.email ?? ""]) ??
      event.locals.ctx.packages.passwordPolicy(next, user);
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
    await ctx.db.repos.transaction(async (tx) => {
      await deleteAccount(tx, user, { posts: ctx.settings.get(deletedMemberPosts), deletedName });
      await ctx.packages.erasePersonal(user.id, tx);
    });
    // The platform services' data about the member goes too (preferences, user fields, and
    // documents they wrote; posts stay or go by the board's setting above).
    await ctx.db.platform.preferences.deleteAll(user.id);
    await ctx.platform.fields.removeEntity("user", user.id);
    await ctx.db.platform.docs.removeByAuthor(user.id);
    // Their uploaded avatar's file, unless someone else uses the same image.
    await releaseAvatar(ctx.config.dataDir, ctx.db.repos, user.avatar);
    clearSessionCookie(event.cookies, ctx.config);
    ctx.log.info("account deleted", { userId: user.id });
    redirect(303, "/?notice=deleted");
  },
};
