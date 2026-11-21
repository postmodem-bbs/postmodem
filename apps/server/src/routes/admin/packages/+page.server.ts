// SPDX-License-Identifier: AGPL-3.0-or-later
// /admin/packages: which installed packages are on (PACKAGES.md, ADR 0019).
import { enabledPackagesSetting } from "@postmodem/core";
import { fail } from "@sveltejs/kit";
import { adminAudit, requireAdmin } from "#lib/server/admin.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals, url }) => {
  requireAdmin(locals, url, "admin.packages");
  const on = new Set(locals.ctx.packages.enabled());
  return {
    profile: locals.ctx.config.profile,
    followsProfile: locals.ctx.settings.get(enabledPackagesSetting) === null,
    packages: locals.ctx.packages.installed.map((p) => ({
      key: p.key,
      name: p.name,
      description: p.description,
      tier: p.tier,
      version: p.version,
      on: on.has(p.key),
      privacyUnavailable: !!p.personalData && locals.ctx.packages.privacyUnavailable(p.key),
      personalData: p.personalData ?? null,
    })),
  };
};

export const actions: Actions = {
  default: async ({ locals, url, request }) => {
    requireAdmin(locals, url, "admin.packages");
    const form = await request.formData();
    const installed = new Set(locals.ctx.packages.installed.map((p) => p.key));
    const on = form
      .getAll("on")
      .map(String)
      .filter((k) => installed.has(k))
      .sort();
    try {
      await locals.ctx.settings.set(enabledPackagesSetting, on);
    } catch {
      return fail(400, { error: true });
    }
    await adminAudit(locals, "packages.changed", "packages", "", { enabled: on });
    return { saved: true };
  },
};
