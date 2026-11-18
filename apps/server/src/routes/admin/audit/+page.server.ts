// SPDX-License-Identifier: AGPL-3.0-or-later
// /admin/audit: the last 200 entries of the audit log (moderation, admin, accounts).
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const { repos } = locals.ctx.db;
  const entries = await repos.audit.recent(200);
  const actors = await repos.users.getMany(entries.flatMap((e) => (e.actorId ? [e.actorId] : [])));
  return {
    entries: entries.map((e) => ({
      id: e.id,
      at: e.at,
      actor: e.actorId ? (actors.get(e.actorId)?.username ?? `#${e.actorId}`) : null,
      action: e.action,
      target: `${e.targetType}${e.targetId ? ` ${e.targetId}` : ""}`,
      details: Object.keys(e.details).length ? JSON.stringify(e.details) : "",
    })),
  };
};
