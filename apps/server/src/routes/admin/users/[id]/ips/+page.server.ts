// SPDX-License-Identifier: AGPL-3.0-or-later
import { ipLogStore } from "@postmodem/modules";
import { error } from "@sveltejs/kit";
import { adminAudit, requireAdmin } from "#lib/server/admin.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url, params, setHeaders }) => {
  requireAdmin(locals, url, "admin.users");
  if (!locals.perms.can("user.viewIp", null)) error(403, "Forbidden");
  if (!locals.ctx.packages.isEnabled("ip-logging")) error(404, "Not found");
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) error(404, "Not found");
  const user = await locals.ctx.db.repos.users.get(id);
  if (!user || user.status === "deleted") error(404, "Not found");
  setHeaders({ "cache-control": "no-store" });
  await adminAudit(locals, "ip-log.viewed", "user", id);
  return {
    name: user.username,
    entries: await ipLogStore(locals.ctx.db.repos.raw).forUser(id, Date.now(), 100),
  };
};
