// SPDX-License-Identifier: AGPL-3.0-or-later
// /admin/users: find a member (?q=exact name or e-mail; newest 50 otherwise) and act: ban
// (optionally for N days), lift bans, activate a pending account, force a password reset
// (the password is deleted and a reset link mailed, if there's an address).
import { banUser, findBan } from "@postmodem/core";
import { fail } from "@sveltejs/kit";
import { adminAudit, requireAdmin } from "#lib/server/admin.ts";
import { sendAccountMail } from "#lib/server/emails.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

const DAY = 86_400_000;

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals, url, "admin.users");
  const { repos } = locals.ctx.db;
  const q = (url.searchParams.get("q") ?? "").trim();
  const found = q
    ? [(await repos.users.byUsername(q)) ?? (await repos.users.byEmail(q))].filter((u) => !!u)
    : (await repos.users.list({ sort: "joined", order: "desc", page: { page: 1, perPage: 50 } })).items;
  const bans = await locals.ctx.activeBans();
  return {
    q,
    users: found.map((u) => ({
      id: u.id,
      name: u.username,
      email: u.email ?? "",
      status: u.status,
      posts: u.postCount,
      joined: u.createdAt,
      lastSeen: u.lastSeenAt,
      banned: !!findBan(bans, { userId: u.id }),
    })),
  };
};

async function target(event: RequestEvent) {
  requireAdmin(event.locals, event.url, "admin.users");
  const form = await event.request.formData();
  const user = await event.locals.ctx.db.repos.users.get(Number(form.get("id")));
  return { form, user };
}

export const actions: Actions = {
  ban: async (event) => {
    const { form, user } = await target(event);
    if (!user) return fail(404, { error: "user" });
    const days = Number(form.get("days")) || 0;
    const ban = await banUser(event.locals.ctx.db.repos, event.locals.user, user.id, {
      reason: String(form.get("reason") ?? "").slice(0, 500),
      expiresAt: days > 0 ? Date.now() + Math.min(days, 3650) * DAY : null,
    });
    if (!ban) return fail(400, { error: "self" });
    event.locals.ctx.invalidateBans();
    return { done: user.username };
  },
  unban: async (event) => {
    const { user } = await target(event);
    if (!user) return fail(404, { error: "user" });
    const { repos } = event.locals.ctx.db;
    for (const b of await repos.bans.active(Date.now()))
      if (b.kind === "user" && b.value === String(user.id)) await repos.bans.remove(b.id);
    if (user.status === "banned") await repos.users.update(user.id, { status: "active" });
    event.locals.ctx.invalidateBans();
    await adminAudit(event.locals, "ban.lifted", "user", user.id);
    return { done: user.username };
  },
  activate: async (event) => {
    const { user } = await target(event);
    if (!user || user.status !== "pending") return fail(400, { error: "user" });
    await event.locals.ctx.db.repos.users.update(user.id, { status: "active" });
    await adminAudit(event.locals, "user.activated", "user", user.id);
    return { done: user.username };
  },
  reset: async (event) => {
    const { user } = await target(event);
    if (!user) return fail(404, { error: "user" });
    const { repos } = event.locals.ctx.db;
    await repos.credentials.remove(user.id);
    await repos.sessions.removeForUser(user.id);
    if (user.email) await sendAccountMail(event.locals.ctx, user, "reset-password", event.locals.locale);
    await adminAudit(event.locals, "user.password-reset-forced", "user", user.id, { mailed: !!user.email });
    return { done: user.username, mailed: !!user.email };
  },
};
