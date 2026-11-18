// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings owned by the core itself.
import { z } from "zod";
import { defineSetting, SettingsRegistry } from "./settings.ts";

export const LOCALES = ["en", "pl"] as const;
export type Locale = (typeof LOCALES)[number];

export const boardName = defineSetting({
  key: "core.board.name",
  schema: z.string().trim().min(1).max(80),
  default: "Postmodem",
});

export const boardDescription = defineSetting({
  key: "core.board.description",
  schema: z.string().trim().max(300),
  default: "",
});

export const defaultLocale = defineSetting<Locale>({
  key: "core.board.defaultLocale",
  schema: z.enum(LOCALES),
  default: "en",
});

export const registrationOpen = defineSetting({
  key: "core.registration.open",
  schema: z.boolean(),
  default: true,
});

/** New accounts must confirm their e-mail address before they can sign in. */
export const verifyEmailOnRegistration = defineSetting({
  key: "core.registration.verifyEmail",
  schema: z.boolean(),
  default: true,
});

/** Board rules shown at registration; empty = the built-in default text for the reader's language. */
export const boardRules = defineSetting({
  key: "core.registration.rules",
  schema: z.string().max(20_000),
  default: "",
});

/** Bump when the rules change materially; users record which version they accepted. */
export const rulesVersion = defineSetting({
  key: "core.registration.rulesVersion",
  schema: z.number().int().min(1),
  default: 1,
});

/** phpBB2's "disallow usernames" list; `*` is a wildcard. Lookalikes of plain entries are blocked too. */
export const disallowedUsernames = defineSetting<string[]>({
  key: "core.registration.disallowedUsernames",
  schema: z.array(z.string().trim().min(1).max(50)).max(1000),
  default: [
    "admin*",
    "administrator",
    "moderator*",
    "mod",
    "postmodem*",
    "root",
    "system",
    "guest",
    "gość",
    "anonymous",
    "anonim",
    "webmaster",
  ],
});

/** Link shape for forums, topics and profiles (ADR 0012). Every style always resolves; links
 * in another style get a 301 to this one, so switching never breaks a link. */
export const URL_STYLES = ["classic", "numbered", "slug"] as const;
export type UrlStyle = (typeof URL_STYLES)[number];
export const urlStyle = defineSetting<UrlStyle>({
  key: "core.urls.style",
  schema: z.enum(URL_STYLES),
  default: "classic",
});

export function coreSettings(): SettingsRegistry {
  return new SettingsRegistry().register(
    boardName,
    boardDescription,
    defaultLocale,
    registrationOpen,
    verifyEmailOnRegistration,
    boardRules,
    rulesVersion,
    disallowedUsernames,
    urlStyle,
  );
}
