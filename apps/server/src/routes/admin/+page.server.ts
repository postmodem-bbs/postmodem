// SPDX-License-Identifier: AGPL-3.0-or-later
// /admin: the board at a glance.
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const { repos } = locals.ctx.db;
  const tree = await repos.nodes.tree();
  return {
    stats: {
      users: await repos.users.count(),
      topics: tree.reduce((s, n) => s + n.topicCount, 0),
      posts: tree.reduce((s, n) => s + n.postCount, 0),
      forums: tree.filter((n) => n.kind === "forum").length,
      bans: (await repos.bans.active(Date.now())).length,
      packages: locals.ctx.packages.enabled().length,
    },
    version: locals.ctx.config.version,
    revision: locals.ctx.config.revision,
    database: locals.ctx.db.dialect,
    mail: locals.ctx.mailer.kind,
    recent: (await repos.audit.recent(10)).map((e) => ({ id: e.id, at: e.at, action: e.action })),
  };
};
