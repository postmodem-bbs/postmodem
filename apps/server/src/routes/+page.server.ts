// SPDX-License-Identifier: AGPL-3.0-or-later
import { loadIndex } from "#lib/server/board.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => ({
  ...(await loadIndex(locals.ctx.db.repos, locals.perms)),
  welcome: url.searchParams.has("welcome") && locals.user ? locals.user.username : null,
});
