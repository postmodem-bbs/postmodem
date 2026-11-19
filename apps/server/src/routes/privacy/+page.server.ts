// SPDX-License-Identifier: AGPL-3.0-or-later
// /privacy — the board's privacy notice: the admin's text, or a built-in one that says what
// Postmodem actually stores (and nothing it doesn't).
import { privacyNotice } from "@postmodem/core";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => ({ custom: locals.ctx.settings.get(privacyNotice) });
