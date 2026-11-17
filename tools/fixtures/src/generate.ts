// SPDX-License-Identifier: AGPL-3.0-or-later
// Generates a phpBB2 "modified by Przemo" v1.12.9 board as SQL, on top of Przemo's own
// schema + install data. Deterministic for a given (preset, seed), and deliberately messy in
// the ways real boards are (see QUIRKS). The manifest tells importer tests what to expect.
import { createHash } from "node:crypto";
import { LANGS, type Lang, POLISH_PANGRAM, postBody, sentence, title } from "./content.ts";
import { Rng } from "./rng.ts";
import { type Charset, encode, InsertBatcher, type Value } from "./sql.ts";

export const GENERATOR_VERSION = 1; // bump when output for the same seed changes

export interface Preset {
  users: number;
  topics: number;
  maxRepliesPerTopic: number;
}
export const PRESETS: Record<string, Preset> = {
  tiny: { users: 20, topics: 40, maxRepliesPerTopic: 6 },
  small: { users: 300, topics: 600, maxRepliesPerTopic: 12 }, // ~4k posts: dev, e2e, importer CI
  large: { users: 5000, topics: 20000, maxRepliesPerTopic: 19 }, // ~200k posts: performance budget
};

export type QuirkKind =
  | "cp1250-in-latin2" // Windows-1250 bytes in a latin2 column (ś, ź, ą, Ś, Ź, Ą differ)
  | "utf8-in-latin2" // UTF-8 bytes stored as if they were latin2 (classic mojibake)
  | "html-entities" // phpBB2 stored &#NNN; for characters outside the charset, and &quot; etc.
  | "broken-bbcode" // unclosed tags, wrong uid suffixes
  | "anonymous-poster" // poster_id = -1 with post_username
  | "dangling-poster" // poster_id points at a user that no longer exists
  | "orphan-post" // post whose topic doesn't exist
  | "stale-counters" // forum/topic counters that don't match reality
  | "missing-smiley-image" // smilies row whose image file doesn't exist
  | "moved-shadow-topic"; // TOPIC_MOVED placeholder left in the old forum

export interface Manifest {
  generator: { version: number; preset: string; seed: number };
  schema: { przemo: "1.12.9"; charset: "latin2" };
  counts: Record<string, number>;
  /** Accounts with known plaintext passwords (all hashes are unsalted MD5, as in phpBB2). */
  accounts: { userId: number; username: string; password: string; level: "admin" | "mod" | "user" }[];
  /** Forums by access model, for permission tests. */
  forums: {
    id: number;
    name: string;
    access: "public" | "registered" | "private" | "moderators";
    parent: string;
  }[];
  quirks: { kind: QuirkKind; table: string; id: number; note: string }[];
  sha256: string;
}

const T0 = 1_104_537_600; // 2005-01-01, Przemo's heyday
const ID_BASE = 1000; // above every id used by Przemo's install data

export function generate(presetName: string, seed: number, write: (chunk: Buffer) => void): Manifest {
  const preset = PRESETS[presetName];
  if (!preset) throw new Error(`unknown preset '${presetName}' (${Object.keys(PRESETS).join(", ")})`);
  const rng = new Rng(seed);
  const hash = createHash("sha256");
  const out = (b: Buffer) => {
    hash.update(b);
    write(b);
  };
  const line = (s: string) => out(Buffer.from(`${s}\n`, "latin1"));
  const quirks: Manifest["quirks"] = [];
  const quirk = (kind: QuirkKind, table: string, id: number, note: string) =>
    quirks.push({ kind, table, id, note });
  const enc = (s: string, cs: Charset = "latin2") => encode(s, cs);

  line(
    `-- Postmodem legacy fixture: Przemo 1.12.9, preset=${presetName}, seed=${seed}, generator=${GENERATOR_VERSION}`,
  );
  line("SET NAMES latin2;");
  line("SET sql_mode = '';");
  line("SET autocommit = 0;");

  // ── groups & users ──────────────────────────────────────────────────────────
  const groups = new InsertBatcher(
    "phpbb_groups",
    ["group_id", "group_type", "group_name", "group_description", "group_moderator", "group_single_user"],
    out,
  );
  const users = new InsertBatcher(
    "phpbb_users",
    [
      "user_id",
      "username",
      "user_level",
      "user_regdate",
      "user_lastvisit",
      "user_password",
      "user_email",
      "user_from",
      "user_sig",
      "user_sig_bbcode_uid",
      "user_posts",
      "user_active",
      "user_rank",
      "user_lang",
      "user_timezone",
      "user_viewemail",
      "user_allowbbcode",
      "user_allowsmile",
      "user_attachsig",
    ],
    out,
  );
  const memberships = new InsertBatcher("phpbb_user_group", ["group_id", "user_id", "user_pending"], out);

  const accounts: Manifest["accounts"] = [
    { userId: 2, username: "Admin", password: "admin", level: "admin" },
  ];
  const userIds: number[] = [2];
  const md5 = (s: string) => createHash("md5").update(s).digest("hex");
  const postCount = new Map<number, number>();
  let groupId = ID_BASE;

  for (let i = 0; i < preset.users; i++) {
    const id = ID_BASE + i;
    const lang = rng.chance(0.7) ? LANGS.pl : LANGS.en;
    const level = i === 0 ? 2 : i < 3 ? 1 : 0; // a moderator and two extra admins
    const name =
      i === 5
        ? "Łukasz Żółć"
        : i === 6
          ? "Zbyszek_Ąę"
          : `${rng.pick(lang.words).replace(/\s/g, "")}${rng.int(1, 999)}_${i}`;
    const password = `pass-${id}`;
    if (i < 8)
      accounts.push({
        userId: id,
        username: name,
        password,
        level: level === 1 ? "admin" : level === 2 ? "mod" : "user",
      });
    const sigUid = rng.hex(10);
    const sig = rng.chance(0.3) ? `[i:${sigUid}]${sentence(rng, lang, 2, 6)}[/i:${sigUid}]` : "";
    const regdate = T0 + rng.int(0, 86400 * 365 * 3);
    users.add([
      id,
      enc(name),
      level,
      regdate,
      regdate + rng.int(0, 86400 * 600),
      Buffer.from(md5(password)),
      Buffer.from(`user${id}@example.invalid`),
      enc(rng.chance(0.5) ? rng.pick(["Kraków", "Łódź", "Gdańsk", "Poznań", "London", ""]) : ""),
      enc(sig),
      Buffer.from(sigUid),
      0,
      1,
      0,
      Buffer.from(lang.code === "pl" ? "polish" : "english"),
      1.0,
      0,
      1,
      1,
      1,
    ]);
    userIds.push(id);
    // phpBB2 gives every user a personal single-user group; per-user permissions hang off it.
    groups.add([groupId, 1, Buffer.from(""), Buffer.from("Personal User"), 0, 1]);
    memberships.add([groupId, id, 0]);
    groupId++;
  }
  const personalGroupOf = (userId: number) => ID_BASE + (userId - ID_BASE);

  // Real groups: open, closed, hidden.
  const groupDefs = [
    { name: "Moderatorzy", type: 1 },
    { name: "Klub Retro", type: 0 },
    { name: "Ukryta ekipa", type: 2 },
  ];
  const realGroups: number[] = [];
  for (const g of groupDefs) {
    groupId++;
    realGroups.push(groupId);
    groups.add([groupId, g.type, enc(g.name), enc(sentence(rng, LANGS.pl, 3, 6)), ID_BASE, 0]);
    for (const uid of userIds.slice(1, 1 + rng.int(3, 15)))
      memberships.add([groupId, uid, rng.chance(0.1) ? 1 : 0]);
  }
  users.flush();
  groups.flush();
  memberships.flush();

  // ── ranks ───────────────────────────────────────────────────────────────────
  const ranks = new InsertBatcher(
    "phpbb_ranks",
    ["rank_id", "rank_title", "rank_min", "rank_special", "rank_image"],
    out,
  );
  [
    ["Nowicjusz", 0],
    ["Bywalec", 50],
    ["Weteran", 500],
    ["Gaduła", 2000],
  ].forEach(([t, min], i) => {
    ranks.add([ID_BASE + i, enc(String(t)), Number(min), 0, Buffer.from("")]);
  });
  ranks.add([ID_BASE + 10, enc("Administrator"), 0, 1, Buffer.from("")]);
  ranks.flush();

  // ── smilies: one whose image is missing ─────────────────────────────────────
  const smilies = new InsertBatcher("phpbb_smilies", ["smilies_id", "code", "smile_url", "emoticon"], out);
  smilies.add([ID_BASE, Buffer.from(":retro:"), Buffer.from("icon_retro_missing.gif"), Buffer.from("Retro")]);
  quirk("missing-smiley-image", "phpbb_smilies", ID_BASE, "icon_retro_missing.gif is not shipped");
  smilies.flush();

  // ── categories & forums, with Przemo sub-forums (category nested under a forum) ─
  const cats = new InsertBatcher(
    "phpbb_categories",
    ["cat_id", "cat_title", "cat_order", "cat_main_type", "cat_main", "cat_desc"],
    out,
  );
  const forumsB = new InsertBatcher(
    "phpbb_forums",
    [
      "forum_id",
      "cat_id",
      "forum_name",
      "forum_desc",
      "forum_status",
      "forum_order",
      "forum_posts",
      "forum_topics",
      "forum_last_post_id",
      "prune_enable",
      "auth_view",
      "auth_read",
      "auth_post",
      "auth_reply",
      "auth_edit",
      "auth_delete",
      "auth_sticky",
      "auth_announce",
      "auth_globalannounce",
      "auth_vote",
      "auth_pollcreate",
      "auth_attachments",
      "auth_download",
      "password",
      "forum_sort",
      "forum_color",
      "forum_link",
      "main_type",
    ],
    out,
  );
  const access = new InsertBatcher(
    "phpbb_auth_access",
    [
      "group_id",
      "forum_id",
      "auth_view",
      "auth_read",
      "auth_post",
      "auth_reply",
      "auth_edit",
      "auth_delete",
      "auth_sticky",
      "auth_announce",
      "auth_globalannounce",
      "auth_vote",
      "auth_pollcreate",
      "auth_attachments",
      "auth_mod",
      "auth_download",
    ],
    out,
  );
  // AUTH_ALL=0, AUTH_REG=1, AUTH_ACL=2, AUTH_MOD=3, AUTH_ADMIN=5
  const MODELS = {
    public: [0, 0, 1, 1, 1, 1, 3, 3, 5, 1, 1, 1, 0],
    registered: [1, 1, 1, 1, 1, 1, 3, 3, 5, 1, 1, 1, 1],
    private: [2, 2, 2, 2, 2, 2, 3, 3, 5, 2, 2, 2, 2],
    moderators: [3, 3, 3, 3, 3, 3, 3, 3, 5, 3, 3, 3, 3],
  } as const;
  type Access = keyof typeof MODELS;

  const forums: Manifest["forums"] = [];
  const forumIds: number[] = [];
  let catId = ID_BASE;
  let forumId = ID_BASE;
  const addForum = (cat: number, parentLabel: string, acc: Access, lang: Lang) => {
    const id = forumId++;
    const name = title(rng, lang);
    forumsB.add([
      id,
      cat,
      enc(name),
      enc(sentence(rng, lang)),
      rng.chance(0.05) ? 1 : 0,
      forumIds.length * 10,
      0,
      0,
      0,
      0,
      ...MODELS[acc],
      Buffer.from(""),
      Buffer.from("SORT_FPDATE"),
      Buffer.from(""),
      Buffer.from(""),
      Buffer.from("c"),
    ]);
    if (acc === "private") {
      access.add([realGroups[1]!, id, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 1]);
      // A per-user grant through a personal group, as phpBB2's "user permissions" page did.
      access.add([personalGroupOf(ID_BASE + 7), id, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
    }
    if (acc === "moderators") access.add([realGroups[0]!, id, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1]);
    forums.push({ id, name, access: acc, parent: parentLabel });
    forumIds.push(id);
    return id;
  };

  const topCats = rng.int(3, 5);
  for (let c = 0; c < topCats; c++) {
    const lang = c % 2 ? LANGS.en : LANGS.pl;
    const cid = catId++;
    const ctitle = c === 0 ? POLISH_PANGRAM.slice(0, 22) : title(rng, lang);
    cats.add([cid, enc(ctitle), c * 10, Buffer.from("c"), 0, enc(sentence(rng, lang))]);
    const n = rng.int(2, 5);
    for (let f = 0; f < n; f++) {
      const acc: Access =
        c === 0 && f === 0
          ? "public"
          : c === 1 && f === 1
            ? "private"
            : c === 2 && f === 0
              ? "moderators"
              : f === 2
                ? "registered"
                : "public";
      const fid = addForum(cid, `category ${cid}`, acc, lang);
      // Przemo sub-forums: a category whose parent is a forum (cat_main_type 'f').
      if (f === 0 && c < 2) {
        const sub = catId++;
        cats.add([sub, enc(title(rng, lang)), 5, Buffer.from("f"), fid, Buffer.from("")]);
        addForum(sub, `forum ${fid}`, "public", lang);
        addForum(sub, `forum ${fid}`, c === 1 ? "registered" : "public", lang);
      }
    }
  }
  cats.flush();
  forumsB.flush();
  access.flush();

  // ── topics, posts, texts ────────────────────────────────────────────────────
  const topics = new InsertBatcher(
    "phpbb_topics",
    [
      "topic_id",
      "forum_id",
      "topic_title",
      "topic_poster",
      "topic_time",
      "topic_views",
      "topic_replies",
      "topic_status",
      "topic_vote",
      "topic_type",
      "topic_first_post_id",
      "topic_last_post_id",
      "topic_moved_id",
    ],
    out,
  );
  const posts = new InsertBatcher(
    "phpbb_posts",
    [
      "post_id",
      "topic_id",
      "forum_id",
      "poster_id",
      "post_time",
      "poster_ip",
      "post_username",
      "enable_bbcode",
      "enable_html",
      "enable_smilies",
      "enable_sig",
      "post_edit_time",
      "post_edit_count",
    ],
    out,
  );
  const texts = new InsertBatcher(
    "phpbb_posts_text",
    ["post_id", "bbcode_uid", "post_subject", "post_text"],
    out,
  );

  const forumStats = new Map<number, { topics: number; posts: number; last: number }>();
  let postId = ID_BASE;
  let topicId = ID_BASE;
  let time = T0 + 86400 * 30;
  const quirkBudget = { cp1250: 0, utf8: 0, entities: 0, broken: 0, anon: 0, dangling: 0 };

  for (let i = 0; i < preset.topics; i++) {
    const tid = topicId++;
    const fid = rng.pick(forumIds);
    const lang = rng.chance(0.7) ? LANGS.pl : LANGS.en;
    const replies = rng.int(0, preset.maxRepliesPerTopic);
    const type = i % 97 === 0 ? 2 : i % 41 === 0 ? 1 : i === 7 ? 3 : 0; // announce, sticky, one global announcement
    const status = i % 53 === 0 ? 1 : 0; // locked
    const ttitle = i === 3 ? `${POLISH_PANGRAM.slice(0, 30)} "cytat" & <tag>` : title(rng, lang);
    const first = postId;
    let starter = 0;
    for (let r = 0; r <= replies; r++) {
      const pid = postId++;
      time += rng.int(60, 7200);
      let poster = rng.pick(userIds);
      let postUsername = "";
      if (rng.chance(0.01)) {
        poster = -1;
        postUsername = `Gość_${rng.int(1, 99)}`;
        if (quirkBudget.anon++ < 50)
          quirk("anonymous-poster", "phpbb_posts", pid, "guest post with post_username");
      } else if (rng.chance(0.004)) {
        poster = 999_000 + rng.int(1, 50);
        if (quirkBudget.dangling++ < 50)
          quirk("dangling-poster", "phpbb_posts", pid, `poster_id ${poster} does not exist`);
      }
      if (r === 0) starter = poster;
      postCount.set(poster, (postCount.get(poster) ?? 0) + 1);
      const uid = rng.hex(10);
      let body = postBody(rng, lang, uid, r > 0 && rng.chance(0.15) ? "Admin" : undefined);
      let charset: Charset = "latin2";
      const q = rng.next();
      if (q < 0.004) {
        charset = "cp1250";
        body = `${POLISH_PANGRAM} ${body}`;
        if (quirkBudget.cp1250++ < 100)
          quirk(
            "cp1250-in-latin2",
            "phpbb_posts_text",
            pid,
            "starts with the Polish pangram in Windows-1250",
          );
      } else if (q < 0.008) {
        charset = "utf8";
        body = `${POLISH_PANGRAM} ${body}`;
        if (quirkBudget.utf8++ < 100)
          quirk(
            "utf8-in-latin2",
            "phpbb_posts_text",
            pid,
            "starts with the Polish pangram as raw UTF-8 bytes",
          );
      } else if (q < 0.012) {
        body = `Cena: 100 &euro; &quot;okazja&quot; &#8364; &#8222;cudzysłów&#8221; ${body}`;
        if (quirkBudget.entities++ < 100)
          quirk("html-entities", "phpbb_posts_text", pid, "contains &quot; &euro; &#8364; &#8222; &#8221;");
      } else if (q < 0.016) {
        body = `[b:${uid}]niezamknięte [i:${rng.hex(10)}]zły uid[/i:${rng.hex(10)}] ${body}`;
        if (quirkBudget.broken++ < 100)
          quirk("broken-bbcode", "phpbb_posts_text", pid, "unclosed [b] and mismatched uid on [i]");
      }
      posts.add([
        pid,
        tid,
        fid,
        poster,
        time,
        Buffer.from("7f000001"),
        enc(postUsername),
        1,
        0,
        1,
        rng.chance(0.5) ? 1 : 0,
        rng.chance(0.05) ? time + 600 : 0,
        rng.chance(0.05) ? rng.int(1, 4) : 0,
      ]);
      texts.add([
        pid,
        Buffer.from(uid),
        enc(r === 0 ? ttitle : rng.chance(0.2) ? `Re: ${ttitle}` : ""),
        encode(body, charset),
      ]);
    }
    const last = postId - 1;
    topics.add([
      tid,
      fid,
      enc(ttitle),
      starter,
      time,
      rng.int(replies, replies * 40 + 5),
      replies,
      status,
      0,
      type,
      first,
      last,
      0,
    ]);
    const s = forumStats.get(fid) ?? { topics: 0, posts: 0, last: 0 };
    s.topics++;
    s.posts += replies + 1;
    s.last = last;
    forumStats.set(fid, s);
  }

  // A moved topic leaves a TOPIC_MOVED shadow in the old forum.
  const movedFrom = forumIds[1]!;
  const shadow = topicId++;
  topics.add([
    shadow,
    movedFrom,
    enc("Przeniesiony temat"),
    userIds[1]!,
    time,
    0,
    0,
    2,
    0,
    0,
    ID_BASE,
    ID_BASE,
    ID_BASE,
  ]);
  quirk("moved-shadow-topic", "phpbb_topics", shadow, `TOPIC_MOVED placeholder pointing at topic ${ID_BASE}`);

  // An orphan post: its topic was deleted without cleanup.
  const orphan = postId++;
  posts.add([
    orphan,
    9_999_999,
    forumIds[0]!,
    userIds[1]!,
    time,
    Buffer.from("7f000001"),
    Buffer.from(""),
    1,
    0,
    1,
    0,
    0,
    0,
  ]);
  texts.add([orphan, Buffer.from(rng.hex(10)), Buffer.from(""), enc("Sierota bez tematu.")]);
  quirk("orphan-post", "phpbb_posts", orphan, "topic 9999999 does not exist");
  topics.flush();
  posts.flush();
  texts.flush();

  // ── denormalised counters, mostly right (as phpBB2 kept them), sometimes stale ─
  let stale = 0;
  for (const [fid, s] of forumStats) {
    const wrong = stale < 3 && rng.chance(0.2);
    if (wrong) {
      stale++;
      quirk(
        "stale-counters",
        "phpbb_forums",
        fid,
        `forum_posts/forum_topics off by design (real: ${s.posts}/${s.topics})`,
      );
    }
    line(
      `UPDATE phpbb_forums SET forum_topics = ${wrong ? s.topics + 7 : s.topics}, forum_posts = ${wrong ? Math.max(0, s.posts - 11) : s.posts}, forum_last_post_id = ${s.last} WHERE forum_id = ${fid};`,
    );
  }
  for (const [uid, n] of postCount)
    if (uid > 0 && uid < 999_000) line(`UPDATE phpbb_users SET user_posts = ${n} WHERE user_id = ${uid};`);
  line("COMMIT;");

  return {
    generator: { version: GENERATOR_VERSION, preset: presetName, seed },
    schema: { przemo: "1.12.9", charset: "latin2" },
    counts: {
      users: users.count,
      groups: groups.count,
      forums: forumsB.count,
      categories: cats.count,
      topics: topics.count,
      posts: posts.count,
      posts_text: texts.count,
      auth_access: access.count,
    },
    accounts,
    forums,
    quirks,
    sha256: hash.digest("hex"),
  };
}

export type { Value };
