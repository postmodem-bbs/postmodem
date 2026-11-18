// SPDX-License-Identifier: AGPL-3.0-or-later
// /admin/access: IP and e-mail bans (member bans are on /admin/users) and registration invites.
import { createHash, randomBytes } from "node:crypto";
import { banProblem } from "@postmodem/core";
import { fail } from "@sveltejs/kit";
import { adminAudit, requireAdmin } from "#lib/server/admin.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

const DAY = 86_400_000;

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals, url, "admin.users");
  const { repos } = locals.ctx.db;
  const now = Date.now();
  const bans = await repos.bans.active(now);
  const users = await repos.users.getMany(bans.filter((b) => b.kind === "user").map((b) => Number(b.value)));
  return {
    bans: bans.map((b) => ({
      id: b.id,
      kind: b.kind,
      value: b.kind === "user" ? (users.get(Number(b.value))?.username ?? `#${b.value}`) : b.value,
      reason: b.reason,
      expiresAt: b.expiresAt,
    })),
    invites: (await repos.invites.list()).map((i) => ({
      id: i.id,
      usesLeft: i.usesLeft,
      expiresAt: i.expiresAt,
      expired: !!i.expiresAt && i.expiresAt < now,
      note: i.note,
    })),
  };
};

async function guarded(event: RequestEvent) {
  requireAdmin(event.locals, event.url, "admin.users");
  return { form: await event.request.formData(), repos: event.locals.ctx.db.repos };
}

export const actions: Actions = {
  ban: async (event) => {
    const { form, repos } = await guarded(event);
    const kind = form.get("kind") === "email" ? "email" : "ip";
    const value = String(form.get("value") ?? "")
      .trim()
      .slice(0, 200);
    if (banProblem(kind, value)) return fail(400, { error: "pattern" });
    const days = Number(form.get("days")) || 0;
    const ban = await repos.bans.create({
      kind,
      value,
      reason: String(form.get("reason") ?? "").slice(0, 500),
      createdBy: event.locals.user!.id,
      expiresAt: days > 0 ? Date.now() + days * DAY : null,
    });
    event.locals.ctx.invalidateBans();
    await adminAudit(event.locals, "ban.created", "ban", ban.id, { kind, value });
    return { done: true };
  },
  unban: async (event) => {
    const { form, repos } = await guarded(event);
    const id = Number(form.get("id"));
    await repos.bans.remove(id);
    event.locals.ctx.invalidateBans();
    await adminAudit(event.locals, "ban.removed", "ban", id);
    return { done: true };
  },
  invite: async (event) => {
    const { form, repos } = await guarded(event);
    const uses = Math.max(1, Math.min(10_000, Number(form.get("uses")) || 1));
    const days = Math.max(1, Math.min(365, Number(form.get("days")) || 14));
    const code = randomBytes(18).toString("base64url");
    const invite = await repos.invites.create({
      codeHash: createHash("sha256").update(code).digest("hex"),
      createdBy: event.locals.user!.id,
      expiresAt: Date.now() + days * DAY,
      usesLeft: uses,
      note: String(form.get("note") ?? "").slice(0, 200),
    });
    await adminAudit(event.locals, "invite.created", "invite", invite.id, { uses, days });
    // Shown once: only the hash is stored.
    return { link: new URL(`/register?invite=${code}`, event.locals.ctx.config.publicUrl).href };
  },
  revoke: async (event) => {
    const { form, repos } = await guarded(event);
    const id = Number(form.get("id"));
    await repos.invites.remove(id);
    await adminAudit(event.locals, "invite.revoked", "invite", id);
    return { done: true };
  },
};
