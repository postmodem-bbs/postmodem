// SPDX-License-Identifier: AGPL-3.0-or-later
import { ADMIN_SECTIONS, requireAdmin } from "#lib/server/admin.ts";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ locals, url }) => {
  requireAdmin(locals, url);
  return {
    adminSections: ADMIN_SECTIONS.filter((s) => !s.capability || locals.perms.can(s.capability, null)),
  };
};
