// SPDX-License-Identifier: AGPL-3.0-or-later
// /admin/groups: phpBB2's user groups (open, closed, hidden) and their members.
import type { GroupKind } from "@postmodem/core";
import { fail } from "@sveltejs/kit";
import { adminAudit, requireAdmin } from "#lib/server/admin.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

const KINDS: GroupKind[] = ["open", "closed", "hidden"];

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals, url, "admin.users");
  const { repos } = locals.ctx.db;
  const groups = await repos.groups.all();
  const out = [];
  for (const g of groups) {
    const members = await repos.groups.members(g.id);
    const users = await repos.users.getMany(members.map((m) => m.userId));
    out.push({
      id: g.id,
      name: g.name,
      kind: g.kind,
      description: g.description,
      members: members.map((m) => ({
        userId: m.userId,
        name: users.get(m.userId)?.username ?? `#${m.userId}`,
        role: m.role,
        pending: m.pending,
      })),
    });
  }
  return { groups: out };
};

async function guarded(event: RequestEvent) {
  requireAdmin(event.locals, event.url, "admin.users");
  return { form: await event.request.formData(), repos: event.locals.ctx.db.repos };
}

export const actions: Actions = {
  create: async (event) => {
    const { form, repos } = await guarded(event);
    const name = String(form.get("name") ?? "")
      .trim()
      .slice(0, 60);
    const kind = String(form.get("kind")) as GroupKind;
    if (!name || !KINDS.includes(kind)) return fail(400, { error: "invalid" });
    if (await repos.groups.byName(name)) return fail(409, { error: "exists" });
    const g = await repos.groups.create({
      name,
      kind,
      description: String(form.get("description") ?? "").slice(0, 500),
    });
    await adminAudit(event.locals, "group.created", "group", g.id, { name, kind });
    return { done: true };
  },
  add: async (event) => {
    const { form, repos } = await guarded(event);
    const group = await repos.groups.get(Number(form.get("group")));
    const user = await repos.users.byUsername(String(form.get("username") ?? "").trim());
    if (!group || !user) return fail(400, { error: "user" });
    const role = form.get("moderator") === "on" ? "moderator" : "member";
    await repos.groups.addMember({ groupId: group.id, userId: user.id, role, pending: false });
    await adminAudit(event.locals, "group.member_added", "group", group.id, { userId: user.id, role });
    return { done: true };
  },
  remove: async (event) => {
    const { form, repos } = await guarded(event);
    const groupId = Number(form.get("group"));
    const userId = Number(form.get("user"));
    await repos.groups.removeMember(groupId, userId);
    await adminAudit(event.locals, "group.member_removed", "group", groupId, { userId });
    return { done: true };
  },
};
