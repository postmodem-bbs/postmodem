// SPDX-License-Identifier: AGPL-3.0-or-later
// phpBB2 "modified by Przemo" (1.12.x) → Postmodem (M1 slice 6, ADR 0018).
//
// Ids are kept for users, forums, topics and posts, so phpBB2's own URLs keep working.
// Categories get new node ids (they share the node table with forums) and are mapped through
// legacy_ids. Each step commits with its checkpoint, so an interrupted import resumes where
// it stopped. Only the core is imported; everything Przemo added is listed in the report as
// "not imported" for its package to take over (PACKAGES §0).
import { createHash } from "node:crypto";
import { type GroupKind, type Id, legacyScheme, type Repositories, type UserStatus } from "@postmodem/core";
import { decodeEntities, fromPhpbb2SmileyCode, fromPhpbb2Storage } from "@postmodem/markup";
import { decodeLegacy, type LegacyCharset } from "./charset.ts";
import {
  type AccessRow,
  AUTH_FIELDS,
  type AuthField,
  PACKAGE_AUTH_FIELDS,
  planForumGrants,
  roleName,
  roleSignature,
} from "./permissions.ts";
import type { LegacySource, Row } from "./source.ts";
import { classifyUnread, type UnreadByOrigin } from "./unread.ts";

export const SOURCE = "przemo";

export interface ImportOptions {
  /** Decode everything as this charset instead of detecting it per value. */
  charset?: Exclude<LegacyCharset, "ascii">;
  batchSize?: number;
  /** Read and map everything, write nothing (one rolled-back transaction). */
  dryRun?: boolean;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

export type IssueKind =
  | "orphan-post"
  | "orphan-topic"
  | "dangling-poster"
  | "guest-poster"
  | "moved-shadow-topic"
  | "stale-counters"
  | "charset-repaired"
  | "duplicate-email"
  | "renamed-user"
  | "unknown-password-hash"
  | "duplicate-smiley"
  | "bbcode-disabled"
  | "flattened-category"
  | "missing-parent"
  | "remote-avatar-dropped"
  | "orphan-poll";

export interface ImportReport {
  source: { kind: "przemo"; prefix: string; tables: number };
  dryRun: boolean;
  resumed: boolean;
  counts: Record<string, { read: number; imported: number; skipped: number }>;
  /** How post texts and titles were decoded. */
  charsets: Record<LegacyCharset, number>;
  /** Per kind: how many, and the first ids (never content). */
  issues: Partial<
    Record<IssueKind, { count: number; examples: { table: string; id: number; note: string }[] }>
  >;
  /** What the core didn't read: for packages, or for nobody (PACKAGES §0). */
  notImported: {
    tables: string[];
    columns: Record<string, string[]>;
    config: string[];
    authColumns: Record<string, string>;
    /** The same, by origin: Przemo additions, stock leftovers, other mods' data (unread.ts). */
    byOrigin?: UnreadByOrigin;
  };
  /** Board settings to apply (the caller owns the settings service). */
  settings: { boardName?: string; boardDescription?: string; defaultLocale?: "en" | "pl" };
  /**
   * Image files the board needs from the old installation, as paths relative to its root,
   * each with where it goes under the new board's uploads directory. The importer reads only
   * the database; the caller copies the files (postmodem import … --files <dir>).
   */
  files: { from: string; to: string }[];
  durationMs: number;
}

// Columns the core reads, per table; everything else lands in notImported.
const USED: Record<string, string[]> = {
  users: [
    "user_id",
    "username",
    "user_password",
    "user_email",
    "user_active",
    "user_actkey",
    "user_level",
    "user_regdate",
    "user_lastvisit",
    "user_posts",
    "user_rank",
    "user_from",
    "user_website",
    "user_sig",
    "user_sig_bbcode_uid",
    "user_lang",
    "user_avatar",
    "user_avatar_type",
  ],
  groups: [
    "group_id",
    "group_type",
    "group_name",
    "group_description",
    "group_moderator",
    "group_single_user",
  ],
  user_group: ["group_id", "user_id", "user_pending"],
  ranks: ["rank_id", "rank_title", "rank_min", "rank_special", "rank_image"],
  smilies: ["smilies_id", "code", "smile_url", "emoticon"],
  categories: ["cat_id", "cat_title", "cat_order", "cat_main_type", "cat_main", "cat_desc"],
  forums: [
    "forum_id",
    "cat_id",
    "forum_name",
    "forum_desc",
    "forum_status",
    "forum_order",
    "forum_posts",
    "forum_topics",
    "forum_link",
    ...AUTH_FIELDS,
  ],
  auth_access: ["group_id", "forum_id", "auth_mod", ...AUTH_FIELDS],
  topics: [
    "topic_id",
    "forum_id",
    "topic_title",
    "topic_poster",
    "topic_time",
    "topic_views",
    "topic_status",
    "topic_type",
    "topic_moved_id",
  ],
  posts: [
    "post_id",
    "topic_id",
    "poster_id",
    "post_time",
    "post_username",
    "enable_bbcode",
    "post_edit_time",
    "post_edit_count",
  ],
  posts_text: ["post_id", "bbcode_uid", "post_subject", "post_text"],
  config: ["config_name", "config_value"],
  vote_desc: ["vote_id", "topic_id", "vote_text", "vote_start", "vote_length", "vote_hide"],
  vote_results: ["vote_id", "vote_option_id", "vote_option_text", "vote_result"],
  vote_voters: ["vote_id", "vote_user_id"],
  banlist: ["ban_userid"],
};
const CONFIG_USED = ["sitename", "site_desc", "default_lang"];

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const bytes = (v: unknown) => (Buffer.isBuffer(v) ? v : v == null ? null : Buffer.from(String(v), "latin1"));
const ms = (seconds: unknown) => (num(seconds) > 0 ? num(seconds) * 1000 : null);
const LOCALES: Record<string, "en" | "pl"> = { polish: "pl", english: "en" };
const TOPIC_TYPES: Record<number, string> = {
  0: "normal",
  1: "sticky",
  2: "announcement",
  3: "announcement",
};
const GROUP_KINDS: Record<number, GroupKind> = { 0: "open", 1: "closed", 2: "hidden" };
const DONE = Number.MAX_SAFE_INTEGER;

class Rollback extends Error {}

/**
 * phpBB2's avatar (user_avatar_type 1 upload, 2 remote URL, 3 gallery) as Postmodem stores it:
 * `upload/<file>` or `gallery/<path>` under the uploads' avatars directory, or an https URL.
 * Paths that could leave that directory, and plain-http URLs, give no avatar.
 */
export function legacyAvatar(type: number, value: string): string | null {
  if (!value) return null;
  if (type === 2) return /^https:\/\/[^\s"'<>]+$/i.test(value) ? value : null;
  const kind = type === 1 ? "upload" : type === 3 ? "gallery" : null;
  if (!kind || !safeRelativePath(value)) return null;
  return `${kind}/${value}`;
}

/** A relative path with no "..", no absolute start, no backslashes or control characters. */
export function safeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length < 256 &&
    ![...path].some((ch) => ch === "\\" || ch.charCodeAt(0) < 32) &&
    !path.startsWith("/") &&
    path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..")
  );
}

/** A post's own subject, or "" when it only repeats the topic title ("Re: …" included). */
export function postSubject(subject: string, topicTitle: string): string {
  const key = (v: string) =>
    v
      .replace(/^(re:\s*)+/i, "")
      .trim()
      .toLowerCase();
  return !subject || key(subject) === key(topicTitle) ? "" : subject;
}

export async function importPrzemo(
  repos: Repositories,
  source: LegacySource,
  opts: ImportOptions = {},
): Promise<ImportReport> {
  const started = Date.now();
  const batchSize = opts.batchSize ?? 500;
  const log = opts.log ?? (() => {});
  const report: ImportReport = {
    source: { kind: "przemo", prefix: source.prefix, tables: 0 },
    dryRun: !!opts.dryRun,
    resumed: false,
    counts: {},
    charsets: { ascii: 0, latin2: 0, cp1250: 0, utf8: 0 },
    issues: {},
    notImported: { tables: [], columns: {}, config: [], authColumns: { ...PACKAGE_AUTH_FIELDS } },
    settings: {},
    files: [],
    durationMs: 0,
  };
  const count = (entity: string, field: "read" | "imported" | "skipped", n = 1) => {
    report.counts[entity] ??= { read: 0, imported: 0, skipped: 0 };
    report.counts[entity][field] += n;
  };
  const issue = (kind: IssueKind, table: string, id: number, note: string) => {
    report.issues[kind] ??= { count: 0, examples: [] };
    const i = report.issues[kind];
    i.count++;
    if (i.examples.length < 20) i.examples.push({ table, id, note });
  };
  const text = (v: unknown, table?: string, id?: number) => {
    const d = decodeLegacy(bytes(v), opts.charset);
    report.charsets[d.charset]++;
    if (table && id !== undefined && (d.charset === "cp1250" || d.charset === "utf8"))
      issue("charset-repaired", table, id, `stored as ${d.charset}, not latin2`);
    return d.text;
  };
  /** Titles, names: decoded bytes, then phpBB2's htmlspecialchars undone once. */
  const plain = (v: unknown, table?: string, id?: number) => decodeEntities(text(v, table, id)).trim();

  const run = async (r: Repositories) => {
    // ── where are we? ────────────────────────────────────────────────────────
    const checkpoint = (step: string) => r.legacyIds.get(SOURCE, "checkpoint", step);
    const setCheckpoint = (rr: Repositories, step: string, at: number) =>
      rr.legacyIds.set(SOURCE, "checkpoint", step, at);
    const startedBefore = (await checkpoint("users")) !== undefined;
    report.resumed = startedBefore;
    if (!startedBefore && ((await r.nodes.tree()).length || (await r.users.count())))
      throw new Error(
        "the board already has forums or users; import into a fresh board (before `postmodem init`), or resume an earlier import",
      );

    const tables = await source.tables();
    report.source.tables = tables.length;
    const has = (t: string) => tables.includes(`${source.prefix}${t}`);

    // ── small reference tables, read once ────────────────────────────────────
    const configRows = has("config") ? await source.all("config") : [];
    const config = new Map(configRows.map((row) => [plain(row.config_name), row.config_value]));
    report.settings = {
      boardName: config.has("sitename") ? plain(config.get("sitename")) || undefined : undefined,
      boardDescription: config.has("site_desc") ? plain(config.get("site_desc")) : undefined,
      defaultLocale: LOCALES[plain(config.get("default_lang"))],
    };
    report.notImported.config = [...config.keys()].filter((k) => !CONFIG_USED.includes(k)).sort();

    const userGroups = await source.all("user_group");
    const groupRows = await source.all("groups", "group_id");
    const singleUserGroups = new Set(
      groupRows.filter((g) => num(g.group_single_user) === 1).map((g) => num(g.group_id)),
    );
    const personalGroups = new Map<Id, Id>();
    for (const ug of userGroups)
      if (singleUserGroups.has(num(ug.group_id)) && num(ug.user_id) > 0)
        personalGroups.set(num(ug.group_id), num(ug.user_id));
    const banned = new Set(
      (has("banlist") ? await source.all("banlist") : []).map((b) => num(b.ban_userid)).filter((u) => u > 0),
    );

    // ── ranks & smilies ──────────────────────────────────────────────────────
    if ((await checkpoint("ranks")) !== DONE)
      await r.transaction(async (tx) => {
        for (const row of await source.all("ranks", "rank_id")) {
          count("ranks", "read");
          const special = num(row.rank_special) === 1;
          await tx.ranks.create({
            id: num(row.rank_id),
            title: plain(row.rank_title),
            minPosts: special ? null : num(row.rank_min),
            special,
            image: plain(row.rank_image) || null,
          });
          count("ranks", "imported");
        }
        const seen = new Set<string>();
        for (const [i, row] of (await source.all("smilies", "smilies_id")).entries()) {
          count("smilies", "read");
          const code = fromPhpbb2SmileyCode(text(row.code));
          if (seen.has(code)) {
            count("smilies", "skipped");
            issue("duplicate-smiley", "smilies", num(row.smilies_id), "same code as an earlier smiley");
            continue;
          }
          seen.add(code);
          await tx.smilies.create({
            id: num(row.smilies_id),
            code,
            image: plain(row.smile_url),
            emotion: plain(row.emoticon),
            position: i,
          });
          count("smilies", "imported");
        }
        await setCheckpoint(tx, "ranks", DONE);
      });
    const rankIds = new Set((await r.ranks.all()).map((rk) => rk.id));

    // ── users ────────────────────────────────────────────────────────────────
    const emailsSeen = new Set<string>();
    for (let after = (await checkpoint("users")) ?? -1; after !== DONE; ) {
      const batch = await source.batch("users", "user_id", after, batchSize, "user_id > 0");
      await r.transaction(async (tx) => {
        for (const row of batch) {
          count("users", "read");
          const id = num(row.user_id);
          let username = plain(row.username, "users", id) || `user ${id}`;
          if (await tx.users.byUsername(username)) {
            const renamed = `${username.slice(0, 18)} (${id})`;
            issue("renamed-user", "users", id, "username collides with another after normalisation");
            username = renamed;
          }
          let email: string | null = plain(row.user_email) || null;
          const emailKey = email?.toLowerCase();
          if (emailKey && (emailsSeen.has(emailKey) || (await tx.users.byEmail(email!)))) {
            issue(
              "duplicate-email",
              "users",
              id,
              "e-mail address already used by an earlier account; left empty",
            );
            email = null;
          }
          if (emailKey && email) emailsSeen.add(emailKey);
          const status: UserStatus = banned.has(id)
            ? "banned"
            : num(row.user_active) === 1
              ? "active"
              : plain(row.user_actkey)
                ? "pending"
                : "banned";
          const rank = num(row.user_rank);
          await tx.users.create({
            id,
            username,
            email,
            status,
            createdAt: ms(row.user_regdate) ?? Date.now(),
            lastSeenAt: ms(row.user_lastvisit),
            postCount: num(row.user_posts),
            rankId: rankIds.has(rank) ? rank : null,
            location: plain(row.user_from),
            website: plain(row.user_website),
            signatureSource: fromPhpbb2Storage(text(row.user_sig), plain(row.user_sig_bbcode_uid)),
            locale: LOCALES[plain(row.user_lang)] ?? null,
            avatar: legacyAvatar(num(row.user_avatar_type), plain(row.user_avatar)),
          });
          if (num(row.user_avatar_type) === 2 && !legacyAvatar(2, plain(row.user_avatar)))
            issue("remote-avatar-dropped", "users", id, "remote avatar without https; not shown");
          const stored = plain(row.user_password);
          const scheme = legacyScheme(stored);
          if (scheme) await tx.credentials.set(id, scheme, stored);
          else issue("unknown-password-hash", "users", id, "no usable password hash; the user must reset it");
          count("users", "imported");
        }
        after = batch.length < batchSize ? DONE : num(batch.at(-1)!.user_id);
        await setCheckpoint(tx, "users", after);
      });
      log("users", { imported: report.counts.users?.imported ?? 0 });
    }

    // ── groups, memberships, the administrators group ────────────────────────
    const adminGroupKey = await r.legacyIds.get(SOURCE, "group", "administrators");
    let adminGroupId = adminGroupKey ?? null;
    if ((await checkpoint("groups")) !== DONE)
      await r.transaction(async (tx) => {
        let maxId = 0;
        for (const g of groupRows) {
          maxId = Math.max(maxId, num(g.group_id));
          if (singleUserGroups.has(num(g.group_id))) continue;
          count("groups", "read");
          await tx.groups.create({
            id: num(g.group_id),
            name: plain(g.group_name, "groups", num(g.group_id)) || `group ${num(g.group_id)}`,
            description: plain(g.group_description),
            kind: GROUP_KINDS[num(g.group_type)] ?? "closed",
          });
          count("groups", "imported");
        }
        const known = new Set((await tx.users.getMany(userGroups.map((ug) => num(ug.user_id)))).keys());
        const leaders = new Map(groupRows.map((g) => [num(g.group_id), num(g.group_moderator)]));
        for (const ug of userGroups) {
          const groupId = num(ug.group_id);
          if (singleUserGroups.has(groupId)) continue;
          count("memberships", "read");
          if (!known.has(num(ug.user_id))) {
            count("memberships", "skipped");
            continue;
          }
          await tx.groups.addMember({
            groupId,
            userId: num(ug.user_id),
            role: leaders.get(groupId) === num(ug.user_id) ? "moderator" : "member",
            pending: num(ug.user_pending) === 1,
          });
          count("memberships", "imported");
        }
        // phpBB2 admins (user_level 1) bypassed forum permissions; a group carries that over.
        const admins = await source.query(
          "SELECT user_id FROM {p}users WHERE user_level = 1 AND user_id > 0",
        );
        adminGroupId = maxId + 1;
        await tx.groups.create({
          id: adminGroupId,
          name: "Administratorzy (import)",
          description: "phpBB2 administrators: full rights on every forum.",
          kind: "hidden",
        });
        for (const a of admins)
          await tx.groups.addMember({
            groupId: adminGroupId,
            userId: num(a.user_id),
            role: "member",
            pending: false,
          });
        await tx.legacyIds.set(SOURCE, "group", "administrators", adminGroupId);
        const adminRole = await tx.roles.byKey("core:admin");
        if (adminRole) await tx.grants.create(adminRole.id, { type: "group", id: adminGroupId }, null);
        await setCheckpoint(tx, "groups", DONE);
      });

    // ── categories & forums → nodes, with permissions ────────────────────────
    const categories = await source.all("categories", "cat_id");
    const forums = await source.all("forums", "forum_id");
    if ((await checkpoint("nodes")) !== DONE)
      await r.transaction(async (tx) => {
        const forumIds = new Set(forums.map((f) => num(f.forum_id)));
        let nextCategoryNode = Math.max(0, ...forumIds) + 1;
        const catById = new Map(categories.map((c) => [num(c.cat_id), c]));
        // Przemo nests a category under a forum to hold its sub-forums; Postmodem nests the
        // forums directly, so such a category maps onto its forum.
        const catNode = new Map<number, Id | null>();
        const resolving = new Set<number>();
        const created = new Set<Id>();
        const ensureForum = async (forumId: number): Promise<Id | null> => {
          if (created.has(forumId)) return forumId;
          const f = forums.find((x) => num(x.forum_id) === forumId);
          if (!f) return null;
          const parent = await ensureCategory(num(f.cat_id));
          if (parent === undefined)
            issue("missing-parent", "forums", forumId, `category ${num(f.cat_id)} does not exist`);
          count("forums", "read");
          const link = plain(f.forum_link);
          await tx.nodes.create({
            id: forumId,
            parentId: parent ?? null,
            kind: link ? "link" : "forum",
            linkUrl: link || null,
            title: plain(f.forum_name, "forums", forumId) || `forum ${forumId}`,
            description: plain(f.forum_desc),
            position: num(f.forum_order),
            locked: num(f.forum_status) === 1,
          });
          created.add(forumId);
          count("forums", "imported");
          return forumId;
        };
        const ensureCategory = async (catId: number): Promise<Id | null | undefined> => {
          if (catNode.has(catId)) return catNode.get(catId);
          const c = catById.get(catId);
          if (!c || resolving.has(catId)) return undefined;
          resolving.add(catId);
          const type = plain(c.cat_main_type);
          const main = num(c.cat_main);
          let id: Id | null;
          if (type === "f" && main > 0 && forumIds.has(main)) {
            id = await ensureForum(main);
            issue(
              "flattened-category",
              "categories",
              catId,
              `sub-forum category of forum ${main}; its forums now sit in that forum`,
            );
          } else {
            const parent = type === "c" && main > 0 ? ((await ensureCategory(main)) ?? null) : null;
            count("categories", "read");
            id = nextCategoryNode++;
            await tx.nodes.create({
              id,
              parentId: parent,
              kind: "category",
              title: plain(c.cat_title, "categories", catId) || `category ${catId}`,
              description: plain(c.cat_desc),
              position: num(c.cat_order),
            });
            count("categories", "imported");
          }
          catNode.set(catId, id);
          await tx.legacyIds.set(SOURCE, "category", String(catId), id ?? 0);
          return id;
        };
        for (const c of categories) await ensureCategory(num(c.cat_id));
        for (const f of forums) await ensureForum(num(f.forum_id));

        // Permissions, one self-contained set of grants per forum.
        const access: AccessRow[] = (await source.all("auth_access")).map((a) => ({
          groupId: num(a.group_id),
          forumId: num(a.forum_id),
          mod: num(a.auth_mod) === 1,
          flags: Object.fromEntries(AUTH_FIELDS.map((f) => [f, num(a[f]) === 1])) as Record<
            AuthField,
            boolean
          >,
        }));
        const knownGroups = new Set(groupRows.map((g) => num(g.group_id)));
        const roleIds = new Map<string, Id>();
        for (const f of forums) {
          const forumId = num(f.forum_id);
          if (!created.has(forumId)) continue;
          const levels = Object.fromEntries(AUTH_FIELDS.map((k) => [k, num(f[k])])) as Record<
            AuthField,
            number
          >;
          const rows = access.filter(
            (a) =>
              knownGroups.has(a.groupId) &&
              !(singleUserGroups.has(a.groupId) && !personalGroups.has(a.groupId)),
          );
          for (const g of planForumGrants({ forumId, levels }, rows, personalGroups, adminGroupId)) {
            const sig = roleSignature(g.capabilities);
            let roleId = roleIds.get(sig);
            if (roleId === undefined) {
              const key = `import:przemo-${createHash("sha256").update(sig).digest("hex").slice(0, 10)}`;
              roleId = (
                await tx.roles.upsert({
                  key,
                  name: roleName(g.capabilities),
                  builtin: false,
                  capabilities: g.capabilities,
                })
              ).id;
              roleIds.set(sig, roleId);
            }
            await tx.grants.create(roleId, g.subject, g.nodeId);
            count("grants", "imported");
          }
        }
        await setCheckpoint(tx, "nodes", DONE);
      });

    // ── topics ───────────────────────────────────────────────────────────────
    const nodeIds = new Set((await r.nodes.tree()).map((n) => n.id));
    for (let after = (await checkpoint("topics")) ?? 0; after !== DONE; ) {
      const batch = await source.batch("topics", "topic_id", after, batchSize);
      await r.transaction(async (tx) => {
        const authors = await tx.users.getMany(batch.map((t) => num(t.topic_poster)).filter((u) => u > 0));
        const rows = [];
        for (const t of batch) {
          count("topics", "read");
          const id = num(t.topic_id);
          if (!nodeIds.has(num(t.forum_id))) {
            count("topics", "skipped");
            issue("orphan-topic", "topics", id, `forum ${num(t.forum_id)} does not exist`);
            continue;
          }
          const moved = num(t.topic_status) === 2 && num(t.topic_moved_id) > 0;
          if (moved) issue("moved-shadow-topic", "topics", id, `points at topic ${num(t.topic_moved_id)}`);
          const poster = num(t.topic_poster);
          rows.push({
            id,
            nodeId: num(t.forum_id),
            title: plain(t.topic_title, "topics", id) || `topic ${id}`,
            authorId: authors.has(poster) ? poster : null,
            type: TOPIC_TYPES[num(t.topic_type)] ?? "normal",
            locked: num(t.topic_status) === 1,
            movedToTopicId: moved ? num(t.topic_moved_id) : null,
            viewCount: num(t.topic_views),
            createdAt: ms(t.topic_time) ?? Date.now(),
          });
          count("topics", "imported");
        }
        await tx.topics.insertMany(rows);
        after = batch.length < batchSize ? DONE : num(batch.at(-1)!.topic_id);
        await setCheckpoint(tx, "topics", after);
      });
      log("topics", { imported: report.counts.topics?.imported ?? 0 });
    }

    // ── posts ────────────────────────────────────────────────────────────────
    for (let after = (await checkpoint("posts")) ?? 0; after !== DONE; ) {
      const batch = await source.batch("posts", "post_id", after, batchSize);
      await r.transaction(async (tx) => {
        const ids = batch.map((p) => num(p.post_id));
        const texts = ids.length
          ? new Map(
              (
                await source.query(
                  `SELECT * FROM {p}posts_text WHERE post_id IN (${ids.map(() => "?").join(",")})`,
                  ids,
                )
              ).map((row) => [num(row.post_id), row] as const),
            )
          : new Map<number, Row>();
        const topics = await tx.topics.getMany(batch.map((p) => num(p.topic_id)));
        const authors = await tx.users.getMany(batch.map((p) => num(p.poster_id)).filter((u) => u > 0));
        const rows = [];
        for (const p of batch) {
          count("posts", "read");
          const id = num(p.post_id);
          const topic = topics.get(num(p.topic_id));
          if (!topic) {
            count("posts", "skipped");
            issue("orphan-post", "posts", id, `topic ${num(p.topic_id)} does not exist`);
            continue;
          }
          const poster = num(p.poster_id);
          let authorId: Id | null = null;
          if (authors.has(poster)) authorId = poster;
          else if (poster > 0) issue("dangling-poster", "posts", id, `user ${poster} does not exist`);
          else issue("guest-poster", "posts", id, "posted as a guest");
          if (num(p.enable_bbcode) === 0)
            issue("bbcode-disabled", "posts", id, "BBCode was off for this post");
          const t = texts.get(id);
          rows.push({
            id,
            topicId: topic.id,
            nodeId: topic.nodeId,
            authorId,
            authorName: authorId === null ? plain(p.post_username) : "",
            subject: postSubject(plain(t?.post_subject, "posts_text", id), topic.title),
            source: fromPhpbb2Storage(text(t?.post_text, "posts_text", id), plain(t?.bbcode_uid)),
            format: "bbcode-phpbb2",
            createdAt: ms(p.post_time) ?? Date.now(),
            editedAt: ms(p.post_edit_time),
            editCount: num(p.post_edit_count),
          });
          count("posts", "imported");
        }
        await tx.posts.insertMany(rows);
        after = batch.length < batchSize ? DONE : num(batch.at(-1)!.post_id);
        await setCheckpoint(tx, "posts", after);
      });
      log("posts", { imported: report.counts.posts?.imported ?? 0 });
    }

    // ── polls (vanilla phpBB2; small, so one transaction) ────────────────────
    if ((await checkpoint("polls")) !== DONE && has("vote_desc")) {
      const results = has("vote_results") ? await source.all("vote_results") : [];
      const voters = has("vote_voters") ? await source.all("vote_voters") : [];
      await r.transaction(async (tx) => {
        for (const v of await source.all("vote_desc")) {
          count("polls", "read");
          const id = num(v.vote_id);
          const topicId = num(v.topic_id);
          if (!(await tx.topics.get(topicId)) || (await tx.polls.forTopic(topicId))) {
            count("polls", "skipped");
            issue("orphan-poll", "vote_desc", id, `no topic ${topicId}, or it already has a poll`);
            continue;
          }
          const startsAt = ms(v.vote_start) ?? Date.now();
          await tx.polls.create({
            id,
            topicId,
            question: plain(v.vote_text, "vote_desc", id),
            startsAt,
            endsAt: num(v.vote_length) > 0 ? startsAt + num(v.vote_length) * 1000 : null,
            hideResults: num(v.vote_hide) === 1,
            options: results
              .filter((o) => num(o.vote_id) === id)
              .map((o) => ({
                position: num(o.vote_option_id),
                text: plain(o.vote_option_text, "vote_results", id),
                votes: num(o.vote_result),
              })),
          });
          const people = voters.filter((x) => num(x.vote_id) === id).map((x) => num(x.vote_user_id));
          const known = await tx.users.getMany(people.filter((u) => u > 0));
          await tx.polls.addVoters(id, [...known.keys()]);
          count("polls", "imported");
        }
        await setCheckpoint(tx, "polls", DONE);
      });
    }

    // ── counters: recomputed, and stale legacy ones reported ─────────────────
    if ((await checkpoint("counters")) !== DONE) {
      for (let after = 0; ; ) {
        const batch = await source.batch("topics", "topic_id", after, batchSize);
        if (!batch.length) break;
        await r.transaction(async (tx) => {
          for (const t of batch)
            if (await tx.topics.get(num(t.topic_id))) await tx.topics.recount(num(t.topic_id));
        });
        after = num(batch.at(-1)!.topic_id);
      }
      await r.transaction(async (tx) => {
        for (const f of forums) {
          const id = num(f.forum_id);
          if (!nodeIds.has(id)) continue;
          const n = await tx.nodes.recount(id);
          if (n.postCount !== num(f.forum_posts) || n.topicCount !== num(f.forum_topics))
            issue(
              "stale-counters",
              "forums",
              id,
              `phpBB2 said ${num(f.forum_topics)} topics/${num(f.forum_posts)} posts, recounted ${n.topicCount}/${n.postCount}`,
            );
        }
        await setCheckpoint(tx, "counters", DONE);
      });
    }

    // ── what the core didn't read ────────────────────────────────────────────
    for (const t of tables) {
      const name = t.slice(source.prefix.length);
      if (!t.startsWith(source.prefix) || !USED[name]) {
        report.notImported.tables.push(t);
        continue;
      }
      const unused = (await source.columns(name)).filter((c) => !USED[name]!.includes(c));
      if (unused.length) report.notImported.columns[t] = unused;
    }
    report.notImported.tables.sort();
    report.notImported.byOrigin = classifyUnread(report.notImported, source.prefix);

    // ── files the new board needs (copied by the caller) ─────────────────────
    const dir = (key: string, fallback: string) => (plain(config.get(key)) || fallback).replace(/\/+$/, "");
    const smileDir = dir("smilies_path", "images/smiles");
    for (const s of await source.query("SELECT DISTINCT smile_url FROM {p}smilies"))
      if (safeRelativePath(plain(s.smile_url)))
        report.files.push({ from: `${smileDir}/${plain(s.smile_url)}`, to: `smilies/${plain(s.smile_url)}` });
    const avatarDirs: Record<number, string> = {
      1: dir("avatar_path", "images/avatars"),
      3: dir("avatar_gallery_path", "images/avatars/gallery"),
    };
    for (const u of await source.query(
      "SELECT DISTINCT user_avatar, user_avatar_type FROM {p}users WHERE user_avatar_type IN (1, 3) AND user_avatar <> ''",
    )) {
      const stored = legacyAvatar(num(u.user_avatar_type), plain(u.user_avatar));
      if (stored)
        report.files.push({
          from: `${avatarDirs[num(u.user_avatar_type)]}/${plain(u.user_avatar)}`,
          to: `avatars/${stored}`,
        });
    }
  };

  try {
    if (opts.dryRun)
      await repos
        .transaction(async (tx) => {
          await run(tx);
          throw new Rollback();
        })
        .catch((e) => {
          if (!(e instanceof Rollback)) throw e;
        });
    else await run(repos);
  } finally {
    report.durationMs = Date.now() - started;
  }
  return report;
}

/** The report without anything that could identify the board or its people. */
export function anonymise(report: ImportReport): ImportReport {
  // File names can be personal (avatars named after people); only their number stays.
  return { ...report, settings: {}, files: report.files.map(() => ({ from: "", to: "" })) };
}

/** A short human summary for the CLI. */
export function summarise(report: ImportReport): string {
  const lines = [
    `${report.dryRun ? "DRY RUN (nothing written)" : "Imported"} from ${report.source.tables} tables (${report.source.prefix}*) in ${(report.durationMs / 1000).toFixed(1)} s${report.resumed ? ", resumed" : ""}`,
    "",
    ...Object.entries(report.counts).map(
      ([k, c]) =>
        `  ${k.padEnd(12)} ${String(c.imported).padStart(8)} imported${c.skipped ? `, ${c.skipped} skipped` : ""}`,
    ),
    "",
    `Text encodings: ${Object.entries(report.charsets)
      .filter(([, n]) => n)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}`,
    "",
    "Issues:",
    ...(Object.entries(report.issues).length
      ? Object.entries(report.issues).map(([k, v]) => `  ${k.padEnd(22)} ${v!.count}`)
      : ["  none"]),
    "",
    `Not imported: ${report.notImported.tables.length} tables, ${Object.values(report.notImported.columns).flat().length} columns, ${report.notImported.config.length} config keys (details in the JSON report)`,
    ...originLines(report.notImported.byOrigin),
  ];
  return lines.join("\n");
}

function originLines(o: UnreadByOrigin | undefined): string[] {
  if (!o) return [];
  const cols = (c: Record<string, string[]>) => Object.values(c).flat().length;
  const lines = [
    `  Przemo features (imported with their packages later): ${o.przemo.tables.length} tables, ${cols(o.przemo.columns)} columns, ${o.przemo.config.length} config keys`,
    `  stock phpBB2/Przemo data nothing needs: ${o.stock.tables.length} tables, ${cols(o.stock.columns)} columns`,
  ];
  if (o.unknown.tables.length || cols(o.unknown.columns))
    lines.push(
      `  NOT from Przemo (another mod's; nothing will import it): ${[
        ...o.unknown.tables,
        ...Object.entries(o.unknown.columns).flatMap(([t, cs]) => cs.map((c) => `${t}.${c}`)),
      ].join(", ")}`,
    );
  else lines.push("  nothing from other mods");
  return lines;
}
