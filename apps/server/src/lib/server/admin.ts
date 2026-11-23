// SPDX-License-Identifier: AGPL-3.0-or-later
// The admin panel v0 (M2 slice 8): every page asks for admin.access plus its own capability,
// and every change goes into the audit log with the admin who made it.
import { error, redirect } from "@sveltejs/kit";

export type AdminCapability =
  | "admin.config"
  | "admin.forums"
  | "admin.users"
  | "admin.permissions"
  | "admin.packages";

/** The signed-in admin, or a redirect to sign in / a 403. */
export function requireAdmin(locals: App.Locals, url: URL, capability?: AdminCapability) {
  if (!locals.user) redirect(303, `/login.php?redirect=${encodeURIComponent(url.pathname + url.search)}`);
  if (!locals.perms.can("admin.access", null) || (capability && !locals.perms.can(capability, null)))
    error(403, "Forbidden");
  return locals.user;
}

export function adminAudit(
  locals: App.Locals,
  action: string,
  targetType: string,
  targetId: string | number,
  details: Record<string, unknown> = {},
) {
  return locals.ctx.db.repos.audit.append({
    actorId: locals.user?.id ?? null,
    action,
    targetType,
    targetId: String(targetId),
    details,
  });
}

export const ADMIN_SECTIONS: { path: string; label: string; capability?: AdminCapability }[] = [
  { path: "/admin", label: "admin-overview" },
  { path: "/admin/settings", label: "admin-settings", capability: "admin.config" },
  { path: "/admin/forums", label: "admin-forums", capability: "admin.forums" },
  { path: "/admin/groups", label: "admin-groups", capability: "admin.users" },
  { path: "/admin/ranks", label: "admin-ranks", capability: "admin.users" },
  { path: "/admin/permissions", label: "admin-permissions", capability: "admin.permissions" },
  { path: "/admin/users", label: "admin-users", capability: "admin.users" },
  { path: "/admin/access", label: "admin-access", capability: "admin.users" },
  { path: "/admin/packages", label: "admin-packages", capability: "admin.packages" },
  { path: "/admin/audit", label: "admin-audit" },
];
