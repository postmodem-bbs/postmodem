// SPDX-License-Identifier: AGPL-3.0-or-later
// /admin/settings: the board settings people actually change, as a form. Values are checked
// by each setting's own schema (core settings.ts); running replicas pick changes up within
// seconds, as with `postmodem settings set`.
import {
  boardDateFormat,
  boardTimeZone,
  DATE_FORMATS,
  defaultTheme,
  THEME_IDS,
  TIME_ZONES,
} from "@postmodem/core";
import { fail } from "@sveltejs/kit";
import { formatDateTime } from "#lib/format.ts";
import { adminAudit, requireAdmin } from "#lib/server/admin.ts";
import type { Actions, PageServerLoad } from "./$types";

type Field =
  | { key: string; type: "text" | "textarea" | "number" | "boolean" | "list" }
  | { key: string; type: "select"; options: string[] };

/** Grouped as the page shows them; labels are `setting-<key with dots as dashes>`. */
const GROUPS: { label: string; fields: Field[] }[] = [
  {
    label: "admin-settings-board",
    fields: [
      { key: "core.board.name", type: "text" },
      { key: "core.board.description", type: "text" },
      { key: "core.board.defaultLocale", type: "select", options: ["en", "pl"] },
      { key: defaultTheme.key, type: "select", options: [...THEME_IDS] },
      { key: boardTimeZone.key, type: "select", options: [...TIME_ZONES] },
      { key: boardDateFormat.key, type: "select", options: [...DATE_FORMATS] },
      { key: "core.urls.style", type: "select", options: ["classic", "numbered", "slug"] },
      { key: "core.board.privacy", type: "textarea" },
      { key: "core.accounts.deletedPosts", type: "select", options: ["keep", "remove"] },
      { key: "core.notify.digestHour", type: "number" },
      { key: "core.email.members", type: "boolean" },
    ],
  },
  {
    label: "admin-settings-registration",
    fields: [
      { key: "core.registration.open", type: "boolean" },
      { key: "core.registration.inviteOnly", type: "boolean" },
      { key: "core.registration.verifyEmail", type: "boolean" },
      { key: "core.registration.rules", type: "textarea" },
      { key: "core.registration.rulesVersion", type: "number" },
      { key: "core.registration.disallowedUsernames", type: "list" },
    ],
  },
  {
    label: "admin-settings-posting",
    fields: [
      { key: "core.posting.floodSeconds", type: "number" },
      { key: "core.posting.perHour", type: "number" },
      { key: "core.posting.maxLength", type: "number" },
      { key: "core.newMembers.posts", type: "number" },
      { key: "core.pm.inboxLimit", type: "number" },
      { key: "core.search.perMinute", type: "number" },
      { key: "core.memberlist.guests", type: "boolean" },
    ],
  },
];

export const load: PageServerLoad = ({ locals, url }) => {
  requireAdmin(locals, url, "admin.config");
  const { settings } = locals.ctx;
  // Date formats are listed as an example date, in the board's own time zone.
  const now = Date.now();
  const dateLabels = Object.fromEntries(
    DATE_FORMATS.map((style) => [
      style,
      formatDateTime(now, { locale: locals.locale, timeZone: settings.get(boardTimeZone), style }),
    ]),
  );
  return {
    dateLabels,
    groups: GROUPS.map((g) => ({
      label: g.label,
      fields: g.fields
        .filter((f) => settings.definition(f.key))
        .map((f) => {
          const value = settings.get(settings.definition(f.key)!);
          return { ...f, value: f.type === "list" ? (value as string[]).join("\n") : value };
        }),
    })),
  };
};

export const actions: Actions = {
  default: async ({ locals, url, request }) => {
    requireAdmin(locals, url, "admin.config");
    const { settings } = locals.ctx;
    const form = await request.formData();
    const errors: Record<string, string> = {};
    const changed: string[] = [];
    for (const f of GROUPS.flatMap((g) => g.fields)) {
      const def = settings.definition(f.key);
      if (!def) continue;
      const raw = form.get(f.key);
      let value: unknown;
      if (f.type === "boolean") value = raw === "on";
      else if (raw === null) continue;
      else if (f.type === "number") value = Number(raw);
      else if (f.type === "list")
        value = String(raw)
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
      else value = String(raw).replace(/\r\n/g, "\n");
      if (JSON.stringify(value) === JSON.stringify(settings.get(def))) continue;
      try {
        await settings.set(def, value);
        changed.push(f.key);
      } catch {
        errors[f.key] = "invalid";
      }
    }
    if (changed.length) await adminAudit(locals, "settings.changed", "settings", "", { keys: changed });
    if (Object.keys(errors).length) return fail(400, { errors, saved: changed.length });
    return { saved: changed.length };
  },
};
