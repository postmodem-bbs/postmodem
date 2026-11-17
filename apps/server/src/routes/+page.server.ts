// SPDX-License-Identifier: AGPL-3.0-or-later
import { loadIndex } from "#lib/server/board.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => loadIndex(locals.ctx.db.repos);
