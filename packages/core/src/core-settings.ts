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

/** IANA time zones the runtime knows, plus UTC (phpBB2 stored a fixed offset instead). */
export const TIME_ZONES: readonly string[] = [
  "UTC",
  ...Intl.supportedValuesOf("timeZone").filter((z) => z !== "UTC"),
];
const ZONES = new Set(TIME_ZONES);
export const isTimeZone = (v: unknown): v is string => typeof v === "string" && ZONES.has(v);

/** How dates are written: the locale's own styles, or ISO 8601 (phpBB2's `date()` strings are gone). */
export const DATE_FORMATS = ["medium", "long", "short", "iso"] as const;
export type DateStyle = (typeof DATE_FORMATS)[number];

/** The board's time zone: guests see it, and members who haven't chosen one (phpBB2 board_timezone). */
export const boardTimeZone = defineSetting({
  key: "core.board.timeZone",
  schema: z.string().refine(isTimeZone),
  default: "UTC",
});

/** The board's date format, for guests and members who keep the board's (phpBB2 default_dateformat). */
export const boardDateFormat = defineSetting<DateStyle>({
  key: "core.board.dateFormat",
  schema: z.enum(DATE_FORMATS),
  default: "medium",
});

/**
 * Members may e-mail each other through the board (phpBB2 board_email_form). The board relays
 * the message; neither address is shown, and only members who allow it can be written to.
 */
export const memberEmail = defineSetting({ key: "core.email.members", schema: z.boolean(), default: true });
/** Where members may take an avatar from (phpBB2 allow_avatar_upload, _remote, _local). */
export const avatarsUpload = defineSetting({
  key: "core.avatars.upload",
  schema: z.boolean(),
  default: true,
});
/** A link the board downloads and keeps a copy of: never shown from the other site. */
export const avatarsRemote = defineSetting({
  key: "core.avatars.remote",
  schema: z.boolean(),
  default: true,
});
export const avatarsGallery = defineSetting({
  key: "core.avatars.gallery",
  schema: z.boolean(),
  default: true,
});
/** phpBB2 avatar_filesize: larger avatars are refused, not resized (#131). */
export const avatarMaxBytes = defineSetting({
  key: "core.avatars.maxBytes",
  schema: z
    .number()
    .int()
    .min(1024)
    .max(1024 * 1024),
  default: 64 * 1024,
});
/** phpBB2 avatar_max_width / avatar_max_height. The page shows avatars smaller. */
export const avatarMaxWidth = defineSetting({
  key: "core.avatars.maxWidth",
  schema: z.number().int().min(16).max(2048),
  default: 512,
});
export const avatarMaxHeight = defineSetting({
  key: "core.avatars.maxHeight",
  schema: z.number().int().min(16).max(2048),
  default: 512,
});

export const THEME_IDS = ["classic", "modern", "terminal"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const defaultTheme = defineSetting<ThemeId>({
  key: "core.board.defaultTheme",
  schema: z.enum(THEME_IDS),
  default: "classic",
});

export const registrationOpen = defineSetting({
  key: "core.registration.open",
  schema: z.boolean(),
  default: true,
});

/** With registration open: only people with an invite link may register (the beta's mode). */
export const registrationInviteOnly = defineSetting({
  key: "core.registration.inviteOnly",
  schema: z.boolean(),
  default: false,
});

/** Until members have this many posts, their posts may not contain links and they can't send private messages. */
export const newMemberPosts = defineSetting({
  key: "core.newMembers.posts",
  schema: z.number().int().min(0).max(1000),
  default: 3,
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

/** phpBB2's flood_interval: seconds a member must wait between two posts (0: no limit). */
export const floodSeconds = defineSetting({
  key: "core.posting.floodSeconds",
  schema: z.number().int().min(0).max(3600),
  default: 15,
});

/**
 * Posts (and reports) a member may send per hour before each further one waits longer
 * (POSTING_POLICY's growing delays); 0 turns the limit off. Moderators aren't exempt.
 */
export const postsPerHour = defineSetting({
  key: "core.posting.perHour",
  schema: z.number().int().min(0).max(10_000),
  default: 30,
});

/** Messages a member's inbox holds before senders are told it's full (phpBB2 max_inbox_privmsgs). */
export const inboxLimit = defineSetting({
  key: "core.pm.inboxLimit",
  schema: z.number().int().min(0).max(100_000),
  default: 500,
});

/** Longest post, in characters (phpBB2 had no limit but MySQL's TEXT: 64 KB). */
export const maxPostLength = defineSetting({
  key: "core.posting.maxLength",
  schema: z.number().int().min(100).max(200_000),
  default: 60_000,
});

/** Enabled packages (PACKAGES.md §5); null means "the profile's list" (POSTMODEM_PROFILE). */
export const enabledPackagesSetting = defineSetting<string[] | null>({
  key: "core.packages.enabled",
  schema: z
    .array(z.string().regex(/^[a-z][a-z0-9-]*$/))
    .max(200)
    .nullable(),
  default: null,
});

/** Searches per IP and minute before each further one waits (0: no limit). */
export const searchesPerMinute = defineSetting({
  key: "core.search.perMinute",
  schema: z.number().int().min(0).max(10_000),
  default: 30,
});

/** The board's privacy notice (plain text, paragraphs separated by blank lines); empty: the built-in one. */
export const privacyNotice = defineSetting({
  key: "core.board.privacy",
  schema: z.string().max(50_000),
  default: "",
});

/** What happens to a deleted member's posts: kept under "Deleted user" (phpBB2), or removed. */
export const deletedMemberPosts = defineSetting<"keep" | "remove">({
  key: "core.accounts.deletedPosts",
  schema: z.enum(["keep", "remove"]),
  default: "keep",
});

/** The hour of the day (in each member's own time zone, UTC if unset) daily digests go out. */
export const digestHour = defineSetting({
  key: "core.notify.digestHour",
  schema: z.number().int().min(0).max(23),
  default: 7,
});

/** Whether guests may see the member list (phpBB2 showed it to everyone). */
export const memberlistForGuests = defineSetting({
  key: "core.memberlist.guests",
  schema: z.boolean(),
  default: true,
});

export function coreSettings(): SettingsRegistry {
  return new SettingsRegistry().register(
    boardName,
    boardDescription,
    defaultLocale,
    defaultTheme,
    boardTimeZone,
    boardDateFormat,
    memberEmail,
    avatarsUpload,
    avatarsRemote,
    avatarsGallery,
    avatarMaxBytes,
    avatarMaxWidth,
    avatarMaxHeight,
    registrationOpen,
    registrationInviteOnly,
    newMemberPosts,
    verifyEmailOnRegistration,
    boardRules,
    rulesVersion,
    disallowedUsernames,
    urlStyle,
    floodSeconds,
    postsPerHour,
    inboxLimit,
    maxPostLength,
    enabledPackagesSetting,
    memberlistForGuests,
    digestHour,
    searchesPerMinute,
    deletedMemberPosts,
    privacyNotice,
  );
}
