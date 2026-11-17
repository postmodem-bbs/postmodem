// SPDX-License-Identifier: AGPL-3.0-or-later
import { loadIndex } from "#lib/server/board.ts";
import type { PageServerLoad } from "./$types";

const NOTICES = ["welcome", "verified", "reset"];

export const load: PageServerLoad = async ({ locals, url }) => ({
  ...(await loadIndex(locals.ctx.db.repos, locals.perms)),
  // One-off confirmations after a redirect (?notice=…), only for the signed-in user they concern.
  notice:
    locals.user && NOTICES.includes(url.searchParams.get("notice") ?? "")
      ? { kind: url.searchParams.get("notice"), name: locals.user.username }
      : null,
});
