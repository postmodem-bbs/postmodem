// SPDX-License-Identifier: AGPL-3.0-or-later
// /admin/permissions: who has which role where (grants, ADR 0015), and the simulator:
// "may this member do this, here, and which grants decided it" (`postmodem perms explain`).
import type { Subject } from "@postmodem/core";
import { fail } from "@sveltejs/kit";
import { adminAudit, requireAdmin } from "#lib/server/admin.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

const SUBJECTS = ["everyone", "guests", "registered", "group", "user"] as const;

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals, url, "admin.permissions");
  const { repos } = locals.ctx.db;
  const [grants, roles, tree, groups] = await Promise.all([
    repos.grants.all(),
    repos.roles.all(),
    repos.nodes.tree(),
    repos.groups.all(),
  ]);
  const users = await repos.users.getMany(
    grants.flatMap((g) => (g.subject.type === "user" ? [g.subject.id] : [])),
  );
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const nodeTitle = new Map(tree.map((n) => [n.id, n.title]));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const describe = (s: Subject) =>
    s.type === "group"
      ? `group:${groupName.get(s.id) ?? s.id}`
      : s.type === "user"
        ? `user:${users.get(s.id)?.username ?? s.id}`
        : s.type;

  // The simulator: ?who=NAME|guest&cap=KEY&node=ID
  let explanation: { allowed: boolean; text: string } | null = null;
  const who = url.searchParams.get("who");
  const cap = url.searchParams.get("cap");
  if (who && cap && locals.ctx.capabilities.get(cap)) {
    const user = who === "guest" ? null : await repos.users.byUsername(who);
    if (user !== undefined) {
      const perms = await locals.ctx.permissions(user?.id ?? null);
      const node = Number(url.searchParams.get("node"))
        ? ((await repos.nodes.get(Number(url.searchParams.get("node")))) ?? null)
        : null;
      explanation = { allowed: perms.can(cap, node), text: perms.explain(cap, node) };
    }
  }
  return {
    grants: grants
      .map((g) => ({
        id: g.id,
        role: roleName.get(g.roleId) ?? `#${g.roleId}`,
        subject: describe(g.subject),
        node: g.nodeId === null ? null : (nodeTitle.get(g.nodeId) ?? `#${g.nodeId}`),
        nodeId: g.nodeId,
      }))
      .sort((a, b) => (a.nodeId ?? 0) - (b.nodeId ?? 0)),
    roles: roles.map((r) => ({ id: r.id, name: r.name, key: r.key })),
    nodes: tree.map((n) => ({ id: n.id, title: `${"— ".repeat(n.depth)}${n.title}` })),
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    capabilities: locals.ctx.capabilities.all().map((c) => c.key),
    simulator: { who: who ?? "", cap: cap ?? "", node: url.searchParams.get("node") ?? "" },
    explanation,
  };
};

async function guarded(event: RequestEvent) {
  requireAdmin(event.locals, event.url, "admin.permissions");
  return { form: await event.request.formData(), repos: event.locals.ctx.db.repos };
}

export const actions: Actions = {
  grant: async (event) => {
    const { form, repos } = await guarded(event);
    const role = await repos.roles.get(Number(form.get("role")));
    const type = String(form.get("subject")) as (typeof SUBJECTS)[number];
    const nodeId = Number(form.get("node")) || null;
    if (!role || !SUBJECTS.includes(type)) return fail(400, { error: "invalid" });
    let subject: Subject;
    if (type === "group") {
      const g = await repos.groups.get(Number(form.get("group")));
      if (!g) return fail(400, { error: "invalid" });
      subject = { type, id: g.id };
    } else if (type === "user") {
      const u = await repos.users.byUsername(String(form.get("username") ?? "").trim());
      if (!u) return fail(400, { error: "user" });
      subject = { type, id: u.id };
    } else subject = { type };
    if (nodeId && !(await repos.nodes.get(nodeId))) return fail(400, { error: "invalid" });
    const g = await repos.grants.create(role.id, subject, nodeId);
    await adminAudit(event.locals, "grant.created", "grant", g.id, { role: role.key, subject, nodeId });
    return { done: true };
  },
  revoke: async (event) => {
    const { form, repos } = await guarded(event);
    const id = Number(form.get("id"));
    // Never the last board-wide administrator: that would lock everyone out of this page.
    const admin = await repos.roles.byKey("core:admin");
    const all = await repos.grants.all();
    const target = all.find((g) => g.id === id);
    const admins = all.filter((g) => g.roleId === admin?.id && g.nodeId === null);
    if (target && target.roleId === admin?.id && target.nodeId === null && admins.length <= 1)
      return fail(409, { error: "last-admin" });
    await repos.grants.remove(id);
    await adminAudit(event.locals, "grant.removed", "grant", id);
    return { done: true };
  },
};
