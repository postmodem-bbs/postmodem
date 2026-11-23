// SPDX-License-Identifier: AGPL-3.0-or-later
// One behavioural suite, run on every engine (ADR 0013): SQLite, PGlite, and a real
// Postgres server when PM_TEST_PG_URL is set.
import { createHash } from "node:crypto";
import {
  authenticate,
  boardName,
  checkEmailToken,
  confirmEmailChange,
  coreSettings,
  endSession,
  hashPassword,
  issueEmailToken,
  pendingEmailChange,
  type Repositories,
  register,
  requestEmailChange,
  resetPassword,
  resolveSession,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SESSION_TOUCH_MS,
  Settings,
  startSession,
  Throttle,
  TOKEN_TTL,
  TreeError,
  verifyEmail,
} from "@postmodem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./database.ts";
import { migrations } from "./migrations.ts";
import { openTestDatabase, testEngines } from "./testing.ts";

describe.each(testEngines())("%s", (engine) => {
  let db: Database;
  let r: Repositories;
  beforeEach(async () => {
    db = await openTestDatabase(engine);
    await db.migrate();
    r = db.repos;
  });
  afterEach(async () => {
    await db.close();
  });

  describe("migrations", () => {
    it("are all applied, idempotent and safe to run concurrently", async () => {
      const fresh = await openTestDatabase(engine);
      try {
        const names = Object.keys(migrations(fresh.dialect));
        expect(await fresh.pendingMigrations()).toEqual(names);
        const [a, b] = await Promise.all([fresh.migrate(), fresh.migrate()]);
        expect([...a, ...b].sort()).toEqual(names);
        expect(await fresh.pendingMigrations()).toEqual([]);
        expect(await fresh.migrate()).toEqual([]);
        await fresh.ping();
      } finally {
        await fresh.close();
      }
    });
  });

  it("persists settings through the core Settings service", async () => {
    const s1 = new Settings(coreSettings(), db.settingsStore());
    await s1.init();
    await s1.set(boardName, "Retro Corner");
    await s1.set(boardName, "Kącik Retro");
    const s2 = new Settings(coreSettings(), db.settingsStore());
    await s2.init();
    expect(s2.get(boardName)).toBe("Kącik Retro");
  });

  describe("ranks (#130)", () => {
    it("are edited and deleted, and a deleted special rank leaves its members", async () => {
      const stars = await r.ranks.create({
        title: "Stars",
        titleKey: null,
        minPosts: 10,
        special: false,
        image: null,
      });
      const crew = await r.ranks.create({
        title: "Crew",
        titleKey: null,
        minPosts: null,
        special: true,
        image: "upload/a.png",
      });
      const ola = await r.users.create({ username: "Ola", email: null, rankId: crew.id });
      await r.users.create({ username: "Bob", email: null, rankId: crew.id });
      expect(await r.ranks.memberCounts()).toEqual(new Map([[crew.id, 2]]));
      expect(await r.ranks.update(stars.id, { title: "Gwiazdy", minPosts: 20 })).toEqual({
        ...stars,
        title: "Gwiazdy",
        minPosts: 20,
      });
      expect((await r.ranks.update(crew.id, { image: null }))?.image).toBeNull();
      await r.ranks.delete(crew.id);
      expect(await r.ranks.get(crew.id)).toBeUndefined();
      expect((await r.users.get(ola.id))?.rankId).toBeNull();
      expect((await r.ranks.all()).map((k) => k.title)).toEqual(["Gwiazdy"]);
    });
  });

  describe("node tree", () => {
    it("builds paths, depth-first order and unique Polish-transliterated slugs", async () => {
      const cat = await r.nodes.create({
        parentId: null,
        kind: "category",
        title: "Główna kategoria",
        position: 1,
      });
      const f2 = await r.nodes.create({ parentId: cat.id, kind: "forum", title: "Sprzęt", position: 2 });
      const f1 = await r.nodes.create({
        parentId: cat.id,
        kind: "forum",
        title: "Zażółć gęślą jaźń",
        position: 1,
      });
      const sub = await r.nodes.create({ parentId: f2.id, kind: "forum", title: "Sprzęt" }); // same title
      const other = await r.nodes.create({ parentId: null, kind: "category", title: "Inne", position: 0 });

      expect(f1.path).toBe(`/${cat.id}/${f1.id}/`);
      expect(sub.depth).toBe(2);
      expect(f1.slug).toBe("zazolc-gesla-jazn");
      expect(f2.slug).toBe("sprzet");
      expect(sub.slug).toBe(`sprzet-${sub.id}`);
      expect((await r.nodes.tree()).map((x) => x.id)).toEqual([other.id, cat.id, f1.id, f2.id, sub.id]);
      expect((await r.nodes.children(cat.id)).map((x) => x.id)).toEqual([f1.id, f2.id]);
      expect((await r.nodes.subtree(f2.id)).map((x) => x.id)).toEqual([f2.id, sub.id]);
      expect((await r.nodes.bySlug("zazolc-gesla-jazn"))?.id).toBe(f1.id);
    });

    it("moves whole subtrees and refuses cycles", async () => {
      const a = await r.nodes.create({ parentId: null, kind: "category", title: "A" });
      const b = await r.nodes.create({ parentId: null, kind: "category", title: "B" });
      const f = await r.nodes.create({ parentId: a.id, kind: "forum", title: "F" });
      const g = await r.nodes.create({ parentId: f.id, kind: "forum", title: "G" });

      const moved = await r.nodes.move(f.id, b.id, 5);
      expect(moved).toMatchObject({ parentId: b.id, path: `/${b.id}/${f.id}/`, depth: 1, position: 5 });
      expect(await r.nodes.get(g.id)).toMatchObject({ path: `/${b.id}/${f.id}/${g.id}/`, depth: 2 });

      const top = await r.nodes.move(f.id, null);
      expect(top).toMatchObject({ parentId: null, path: `/${f.id}/`, depth: 0 });
      expect((await r.nodes.get(g.id))?.depth).toBe(1);

      await expect(r.nodes.move(f.id, g.id)).rejects.toThrow(TreeError);
      await expect(r.nodes.create({ parentId: 999_999, kind: "forum", title: "x" })).rejects.toThrow(
        /does not exist/,
      );
    });

    it("keeps legacy ids and continues with fresh ids after a sequence sync", async () => {
      const legacy = await r.nodes.create({ id: 1000, parentId: null, kind: "category", title: "Legacy" });
      expect(legacy.id).toBe(1000);
      await db.syncIdSequences();
      const next = await r.nodes.create({ parentId: null, kind: "category", title: "New" });
      expect(next.id).toBeGreaterThan(1000);
    });
  });

  describe("topics and posts", () => {
    async function seed() {
      const forum = await r.nodes.create({ parentId: null, kind: "forum", title: "Forum" });
      const alice = await r.users.create({ username: "alice", email: "alice@example.org" });
      const t0 = 1_700_000_000_000;
      const mk = async (title: string, type: string, lastAt: number) => {
        const t = await r.topics.create({ nodeId: forum.id, title, authorId: alice.id, type, createdAt: t0 });
        await r.posts.create({
          topicId: t.id,
          authorId: alice.id,
          source: "first",
          format: "bbcode-phpbb2",
          createdAt: t0,
        });
        await r.posts.create({
          topicId: t.id,
          authorId: null,
          authorName: "Gość",
          source: "reply",
          format: "bbcode-phpbb2",
          createdAt: lastAt,
        });
        return r.topics.recount(t.id);
      };
      const old = await mk("Old", "normal", t0 + 1000);
      const recent = await mk("Recent", "normal", t0 + 9000);
      const sticky = await mk("Sticky", "sticky", t0 + 500);
      const ann = await mk("Announcement", "announcement", t0 + 100);
      return { forum, alice, old, recent, sticky, ann, t0 };
    }

    it("lists a user's recent topics in the given forums only", async () => {
      const { forum, alice, old, recent, sticky, ann } = await seed();
      const other = await r.nodes.create({ parentId: null, kind: "forum", title: "Other" });
      await r.topics.create({ nodeId: other.id, title: "Elsewhere", authorId: alice.id, createdAt: 1 });
      const ids = (await r.topics.recentByAuthor(alice.id, [forum.id], 3)).map((t) => t.id);
      expect(ids).toEqual([ann.id, sticky.id, recent.id]);
      expect(old.id).toBeLessThan(recent.id);
      expect(await r.topics.recentByAuthor(alice.id, [], 3)).toEqual([]);
      expect(await r.topics.recentByAuthor(alice.id, [other.id], 3)).toHaveLength(1);
    });

    it("stores a topic's poll with its options and voters", async () => {
      const { alice, recent } = await seed();
      const poll = await r.polls.create({
        id: 77,
        topicId: recent.id,
        question: "Amiga czy Atari?",
        startsAt: 1_700_000_000_000,
        endsAt: null,
        hideResults: true,
        options: [
          { position: 2, text: "Atari", votes: 3 },
          { position: 1, text: "Amiga", votes: 5 },
        ],
      });
      expect(poll).toMatchObject({ id: 77, hideResults: true, voterCount: 0 });
      expect(poll.options.map((o) => o.text)).toEqual(["Amiga", "Atari"]);
      await r.polls.addVoters(poll.id, [alice.id, alice.id]);
      await r.polls.addVoters(poll.id, [alice.id]);
      expect((await r.polls.forTopic(recent.id))?.voterCount).toBe(1);
      expect(await r.polls.forTopic(999)).toBeUndefined();
    });

    it("lists announcements, stickies, then by latest activity, with pagination", async () => {
      const { forum, old, recent, sticky, ann } = await seed();
      const page1 = await r.topics.listByNode(forum.id, { page: 1, perPage: 3 });
      expect(page1.items.map((t) => t.id)).toEqual([ann.id, sticky.id, recent.id]);
      expect(page1).toMatchObject({ total: 4, pages: 2 });
      const page2 = await r.topics.listByNode(forum.id, { page: 2, perPage: 3 });
      expect(page2.items.map((t) => t.id)).toEqual([old.id]);
    });

    it("recounts topics and nodes from public content, ignoring deleted posts and moved shadows", async () => {
      const { forum, recent, t0 } = await seed();
      expect(recent).toMatchObject({ replyCount: 1, lastPostAt: t0 + 9000 });
      const deleted = await r.posts.create({
        topicId: recent.id,
        authorId: null,
        source: "spam",
        format: "bbcode-phpbb2",
        visibility: "core:deleted",
        createdAt: t0 + 99_000,
      });
      expect((await r.topics.recount(recent.id)).lastPostId).not.toBe(deleted.id);
      await r.topics.create({ nodeId: forum.id, title: "Moved", authorId: null, movedToTopicId: recent.id });
      const node = await r.nodes.recount(forum.id);
      expect(node).toMatchObject({ topicCount: 4, postCount: 8, lastPostId: recent.lastPostId });
    });

    it("pages posts oldest-first and finds a post's position for permalinks", async () => {
      const { recent } = await seed();
      const posts = await r.posts.listByTopic(recent.id, { page: 1, perPage: 10 });
      expect(posts.items.map((p) => p.source)).toEqual(["first", "reply"]);
      expect(posts.items[1]).toMatchObject({ authorId: null, authorName: "Gość" });
      expect(await r.posts.positionInTopic(posts.items[1]!.id)).toBe(1);
      await r.posts.setRendered(posts.items[0]!.id, "<p>first</p>", 3);
      expect(await r.posts.get(posts.items[0]!.id)).toMatchObject({
        rendered: "<p>first</p>",
        renderVersion: 3,
      });
      expect((await r.posts.getMany([posts.items[0]!.id, posts.items[1]!.id])).size).toBe(2);
      expect((await r.topics.getMany([recent.id, recent.id])).get(recent.id)?.title).toBe("Recent");
      expect((await r.posts.getMany([])).size).toBe(0);
      await r.topics.addViews(recent.id, 5);
      expect((await r.topics.get(recent.id))?.viewCount).toBe(5);
    });
  });

  describe("users, groups, roles, grants", () => {
    it("enforces unique normalised usernames per origin and e-mails case-insensitively", async () => {
      const u = await r.users.create({ username: "Łukasz Żółć", email: "Lukasz@Example.org" });
      expect(u.usernameKey).toBe("łukasz żółć");
      expect((await r.users.byUsername("łukasz  ŻÓŁĆ"))?.id).toBe(u.id);
      expect((await r.users.byEmail("lukasz@example.ORG"))?.id).toBe(u.id);
      await expect(r.users.create({ username: "ŁUKASZ ŻÓŁĆ", email: null })).rejects.toThrow();
      await expect(r.users.create({ username: "other", email: "LUKASZ@example.org" })).rejects.toThrow();
      const remote = await r.users.create({
        username: "Łukasz Żółć",
        email: null,
        origin: "mastodon.example",
      });
      expect(remote.origin).toBe("mastodon.example");
      expect((await r.users.byUsername("Łukasz Żółć"))?.id).toBe(u.id); // local wins
      expect((await r.users.getMany([u.id, remote.id, u.id])).size).toBe(2);
      expect(await r.users.count()).toBe(2);
      expect((await r.users.newest())?.id).toBe(u.id); // remote users aren't "newest member"
    });

    it("stores credentials, memberships, roles and scoped grants", async () => {
      const u = await r.users.create({ username: "bob", email: null });
      await r.credentials.set(u.id, "phpbb2-md5", "21232f297a57a5a743894a0e4a801fc3");
      await r.credentials.set(u.id, "argon2id", "$argon2id$v=19$…");
      expect(await r.credentials.get(u.id)).toMatchObject({ scheme: "argon2id" });

      const club = await r.groups.create({ name: "Klub Retro", description: "", kind: "open" });
      const hidden = await r.groups.create({ name: "Ukryta ekipa", description: "", kind: "hidden" });
      await r.groups.addMember({ groupId: club.id, userId: u.id, role: "member", pending: false });
      await r.groups.addMember({ groupId: hidden.id, userId: u.id, role: "member", pending: true });
      expect(await r.groups.groupsOf(u.id)).toEqual([club.id]);
      await r.groups.addMember({ groupId: hidden.id, userId: u.id, role: "moderator", pending: false });
      expect(await r.groups.groupsOf(u.id)).toEqual([club.id, hidden.id]);
      expect((await r.groups.byName("klub retro"))?.id).toBe(club.id);

      const role = await r.roles.upsert({
        key: "core:member",
        name: "Member",
        builtin: true,
        capabilities: { "node.read": "allow", "topic.create": "allow" },
      });
      const again = await r.roles.upsert({
        key: "core:member",
        name: "Member",
        builtin: true,
        capabilities: { "node.read": "allow", "admin.all": "never" },
      });
      expect(again.id).toBe(role.id);
      expect(again.capabilities).toEqual({ "node.read": "allow", "admin.all": "never" });

      const forum = await r.nodes.create({ parentId: null, kind: "forum", title: "Private" });
      const boardWide = await r.grants.create(role.id, { type: "registered" }, null);
      const scoped = await r.grants.create(role.id, { type: "group", id: club.id }, forum.id);
      await r.grants.create(role.id, { type: "user", id: u.id }, forum.id);
      expect((await r.grants.forScopes([null])).map((g) => g.id)).toEqual([boardWide.id]);
      const forForum = await r.grants.forScopes([forum.id]);
      expect(forForum.map((g) => g.subject)).toEqual([
        { type: "group", id: club.id },
        { type: "user", id: u.id },
      ]);
      await r.grants.remove(scoped.id);
      expect(await r.grants.all()).toHaveLength(2);
      expect((await r.groups.all()).map((g) => g.name)).toEqual(["Klub Retro", "Ukryta ekipa"]);
    });

    it("lists users with recently used, unexpired sessions", async () => {
      const now = Date.now();
      const [a, b, c] = await Promise.all(
        ["a1", "b1", "c1"].map((u) => r.users.create({ username: u, email: null })),
      );
      const s = (id: string, userId: number, lastSeenAt: number, expiresAt = now + 60_000) =>
        r.sessions.create({
          id,
          userId,
          createdAt: lastSeenAt,
          lastSeenAt,
          expiresAt,
          userAgent: "",
          ip: "",
        });
      await s("s1", a!.id, now - 60_000);
      await s("s2", a!.id, now - 1_000);
      await s("s3", b!.id, now - 30_000);
      await s("s4", c!.id, now - 3_600_000);
      await s("s5", c!.id, now - 1_000, now - 1);
      expect(await r.sessions.activeUserIds(now - 600_000, now)).toEqual([a!.id, b!.id]);
    });

    it("finds legacy hashes unused since a date, and removes credentials", async () => {
      const day = 86_400_000;
      const now = Date.now();
      const never = await r.users.create({ username: "never", email: null });
      const old = await r.users.create({ username: "old", email: null, lastSeenAt: now - 400 * day });
      const recent = await r.users.create({ username: "recent", email: null, lastSeenAt: now - day });
      const upgraded = await r.users.create({ username: "upgraded", email: null });
      await r.credentials.set(never.id, "phpbb2-md5", "21232f297a57a5a743894a0e4a801fc3");
      await r.credentials.set(old.id, "phpass", "$H$9abcdefghijklmnopqrstuvwxyz0123");
      await r.credentials.set(recent.id, "phpbb2-md5", "21232f297a57a5a743894a0e4a801fc3");
      await r.credentials.set(upgraded.id, "argon2id", "$argon2id$v=19$…");
      expect(await r.credentials.legacyUnusedSince(now - 180 * day)).toEqual([
        { userId: never.id, scheme: "phpbb2-md5" },
        { userId: old.id, scheme: "phpass" },
      ]);
      await r.credentials.remove(old.id);
      expect(await r.credentials.get(old.id)).toBeUndefined();
    });
  });

  describe("bookkeeping", () => {
    it("maps legacy ids, slug history, audit entries, ranks and smilies", async () => {
      await r.legacyIds.set("przemo", "topic", "123", 4567);
      await r.legacyIds.set("przemo", "topic", "123", 4568);
      expect(await r.legacyIds.get("przemo", "topic", "123")).toBe(4568);
      await r.slugs.record("topic", "stary-tytul", 4568);
      expect(await r.slugs.resolve("topic", "stary-tytul")).toBe(4568);
      await r.audit.append({
        actorId: null,
        action: "import.finished",
        targetType: "board",
        targetId: "1",
        details: { posts: 3 },
      });
      expect((await r.audit.recent(5))[0]).toMatchObject({
        action: "import.finished",
        details: { posts: 3 },
      });
      await r.ranks.create({ title: "Nowicjusz", titleKey: null, minPosts: 0, special: false, image: null });
      await r.ranks.create({ title: "Admin", titleKey: null, minPosts: null, special: true, image: null });
      expect((await r.ranks.all()).map((x) => x.title)).toEqual(["Admin", "Nowicjusz"]);
      await r.smilies.create({ code: ":-)", image: "icon_smile.gif", emotion: "Smile", position: 1 });
      await expect(
        r.smilies.create({ code: ":-)", image: "x.gif", emotion: "", position: 2 }),
      ).rejects.toThrow();
      expect(await r.smilies.all()).toHaveLength(1);
    });

    it("gives renamed forums, topics and users new slugs and keeps the old ones resolving", async () => {
      const forum = await r.nodes.create({ parentId: null, kind: "forum", title: "Stare forum" });
      const renamed = await r.nodes.update(forum.id, { title: "Nowe forum" });
      expect(renamed.slug).toBe("nowe-forum");
      expect(await r.slugs.resolve("node", "stare-forum")).toBe(forum.id);

      const topic = await r.topics.create({ nodeId: forum.id, title: "Pierwszy tytuł", authorId: null });
      expect((await r.topics.rename(topic.id, "Drugi tytuł")).slug).toBe("drugi-tytul");
      expect(await r.slugs.resolve("topic", "pierwszy-tytul")).toBe(topic.id);
      // Imported topics keep their id in the slug, so a rename can't collide.
      await r.topics.insertMany([{ id: 9001, nodeId: forum.id, title: "Import", authorId: null }]);
      expect((await r.topics.rename(9001, "Po imporcie")).slug).toBe("po-imporcie-9001");

      const a = await r.users.create({ username: "Łukasz Żółć", email: null });
      const b = await r.users.create({ username: "lukasz zolc", email: null });
      expect(a.slug).toBe("lukasz-zolc");
      expect(b.slug).toBe(`lukasz-zolc-${b.id}`);
      expect((await r.users.bySlug("lukasz-zolc"))?.id).toBe(a.id);
      await r.users.update(a.id, { username: "Łukasz" });
      expect((await r.users.get(a.id))?.slug).toBe("lukasz");
      expect(await r.slugs.resolve("user", "lukasz-zolc")).toBe(a.id);
      const cats = await r.legacyIds.list("category");
      expect(cats).toEqual([]);
    });

    it("rolls back everything in a failed transaction", async () => {
      await expect(
        r.transaction(async (tx) => {
          await tx.nodes.create({ parentId: null, kind: "category", title: "Ghost" });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await r.nodes.tree()).toEqual([]);
    });
  });

  describe("accounts and sessions", () => {
    const policy = { disallowedUsernames: ["admin*"], rulesVersion: 3, verifyEmail: false };
    const input = { username: "Ola", email: "ola@example.org", password: "correct horse", acceptRules: true };

    it("registers, refusing lookalike names, taken e-mails and missing consent", async () => {
      const ok = await register(r, policy, input, 1000);
      expect(ok.ok).toBe(true);
      if (!ok.ok) return;
      expect(ok.user).toMatchObject({
        username: "Ola",
        rulesVersion: 3,
        rulesAcceptedAt: 1000,
        status: "active",
      });
      expect((await r.credentials.get(ok.user.id))?.scheme).toBe("argon2id");

      const again = await register(r, policy, {
        ...input,
        username: "0la",
        email: "OLA@example.org",
        acceptRules: false,
      });
      expect(again).toEqual({ ok: false, errors: { username: "taken", email: "taken", rules: "required" } });
      const bad = await register(r, policy, {
        ...input,
        username: "AdminX",
        email: "x@example.org",
        password: "short",
      });
      expect(bad).toEqual({ ok: false, errors: { username: "disallowed", password: "too-short" } });
    });

    it("signs in by name or e-mail and upgrades legacy hashes", async () => {
      const u = await r.users.create({ username: "Łukasz Żółć", email: "lukasz@example.org" });
      await r.credentials.set(u.id, "phpbb2-md5", createHash("md5").update("stare-haslo").digest("hex"));
      expect(await authenticate(r, "łukasz żółć", "wrong-password")).toEqual({
        ok: false,
        reason: "invalid",
      });
      expect((await authenticate(r, "  ŁUKASZ ŻÓŁĆ ", "stare-haslo")).ok).toBe(true);
      expect((await r.credentials.get(u.id))?.scheme).toBe("argon2id");
      expect((await authenticate(r, "lukasz@example.org", "stare-haslo")).ok).toBe(true);
      expect(await authenticate(r, "nobody", "whatever-123")).toEqual({ ok: false, reason: "invalid" });
      await r.users.update(u.id, { status: "banned" });
      expect(await authenticate(r, "Łukasz Żółć", "stare-haslo")).toEqual({ ok: false, reason: "inactive" });
    });

    it("keeps sessions server-side with idle and absolute expiry", async () => {
      const u = await r.users.create({ username: "Ola", email: null });
      const t0 = 1_000_000;
      const { token, session } = await startSession(r, u.id, { userAgent: "test", ip: "127.0.0.1" }, t0);
      expect(session.id).not.toBe(token); // only the hash is stored
      expect((await resolveSession(r, token, t0 + 1000))?.user.id).toBe(u.id);
      expect(await resolveSession(r, "x".repeat(43), t0)).toBeNull();
      expect(await resolveSession(r, token, t0 + SESSION_TOUCH_MS, () => false)).toBeNull();
      expect((await r.sessions.get(session.id))?.lastSeenAt).toBe(t0);

      // Activity slides the idle window...
      const later = t0 + SESSION_IDLE_MS - 1;
      expect(await resolveSession(r, token, later)).not.toBeNull();
      expect((await r.sessions.get(session.id))?.lastSeenAt).toBe(later);
      // ...but never past the absolute limit.
      expect(await resolveSession(r, token, t0 + SESSION_ABSOLUTE_MS)).toBeNull();
      expect(await r.sessions.get(session.id)).toBeUndefined();

      const a = await startSession(r, u.id, { userAgent: "a", ip: "" }, t0);
      const b = await startSession(r, u.id, { userAgent: "b", ip: "" }, t0);
      expect(await r.sessions.removeForUser(u.id, a.session.id)).toBe(1);
      expect(await resolveSession(r, b.token, t0)).toBeNull();
      expect(await resolveSession(r, a.token, t0)).not.toBeNull();
      await endSession(r, a.token);
      expect(await resolveSession(r, a.token, t0)).toBeNull();
    });

    it("ends sessions of users who are no longer active, and purges expired ones", async () => {
      const u = await r.users.create({ username: "retro_fan", email: null });
      const { token } = await startSession(r, u.id, { userAgent: "", ip: "" }, 0);
      await r.users.update(u.id, { status: "banned" });
      expect(await resolveSession(r, token, 1)).toBeNull();
      await startSession(r, u.id, { userAgent: "", ip: "" }, 0);
      expect(await r.sessions.purgeExpired(SESSION_IDLE_MS + 1)).toBe(1);
    });
  });

  describe("job queue", () => {
    it("claims due jobs once, retries failures and drops payloads when finished", async () => {
      const id = await r.jobs.enqueue("mail.send", { to: "ola@example.org" });
      await r.jobs.enqueue("mail.send", { later: true }, { runAt: Date.now() + 3600_000 });
      await r.jobs.enqueue("other.type", {});
      const now = Date.now();
      // Two workers race for the one due mail job: exactly one wins.
      const [a, b] = await Promise.all([
        r.jobs.claim(["mail.send"], "w1", now, 60_000),
        r.jobs.claim(["mail.send"], "w2", now, 60_000),
      ]);
      const won = [a, b].filter(Boolean);
      expect(won).toHaveLength(1);
      expect(won[0]).toMatchObject({
        id,
        status: "running",
        attempts: 1,
        payload: { to: "ola@example.org" },
      });
      expect(await r.jobs.claim(["mail.send"], "w3", now, 60_000)).toBeUndefined();

      // A crashed worker's lease runs out and the job comes back.
      const again = await r.jobs.claim(["mail.send"], "w3", now + 61_000, 60_000);
      expect(again).toMatchObject({ id, lockedBy: "w3", attempts: 2 });
      await r.jobs.fail(id, "smtp timeout", now, now + 1000);
      expect(await r.jobs.get(id)).toMatchObject({ status: "queued", lastError: "smtp timeout" });
      await r.jobs.claim(["mail.send"], "w1", now + 1000, 60_000);
      await r.jobs.complete(id, now + 2000);
      expect(await r.jobs.get(id)).toMatchObject({ status: "done", payload: {}, finishedAt: now + 2000 });
      expect(await r.jobs.purgeFinished(now + 3000)).toBe(1);
    });
  });

  describe("e-mail tokens and throttle", () => {
    it("issues single-use tokens, revokes older ones and expires them", async () => {
      const u = await r.users.create({ username: "Ola", email: "ola@example.org", status: "pending" });
      const first = await issueEmailToken(r, u.id, "verify-email", 1000);
      const second = await issueEmailToken(r, u.id, "verify-email", 2000);
      expect(await r.emailTokens.lastIssued(u.id, "verify-email")).toBe(2000);
      expect(await verifyEmail(r, first, 3000)).toBeUndefined(); // revoked by the newer one
      expect((await checkEmailToken(r, second, "verify-email", 3000))?.id).toBe(u.id);
      expect((await verifyEmail(r, second, 3000))?.status).toBe("active");
      expect(await verifyEmail(r, second, 3000)).toBeUndefined(); // single use
      const late = await issueEmailToken(r, u.id, "verify-email", 0);
      expect(await verifyEmail(r, late, TOKEN_TTL["verify-email"] + 1)).toBeUndefined();
    });

    it("changes only to the newest verified address and revokes old mailbox links", async () => {
      const user = await r.users.create({ username: "Ola", email: "old@example.org", status: "active" });
      const password = "a long account passphrase";
      const { scheme, hash } = await hashPassword(password);
      await r.credentials.set(user.id, scheme, hash);
      const reset = await issueEmailToken(r, user.id, "reset-password");
      const issued: string[] = [];
      const enqueue = async (_repos: Repositories, _user: typeof user, token: string) => {
        issued.push(token);
      };
      const send = (email: string, pw = password) => requestEmailChange(r, user.id, email, pw, enqueue);
      expect(await send("first@example.org", "wrong password")).toBe("wrong");
      expect(await send("first@example.org")).toBeUndefined();
      expect(await send("second@example.org")).toBeUndefined();
      const [older, newest] = issued as [string, string];
      expect(await pendingEmailChange(r, user.id, older)).toBeUndefined();
      expect(
        await pendingEmailChange(r, user.id, newest, Date.now() + TOKEN_TTL["change-email"]),
      ).toBeUndefined();
      expect(await pendingEmailChange(r, user.id + 1, newest)).toBeUndefined();
      expect(await pendingEmailChange(r, user.id, newest)).toBe("second@example.org");
      expect((await r.users.get(user.id))?.email).toBe("old@example.org");
      const races = await Promise.all([
        confirmEmailChange(r, user.id, newest, () => false),
        confirmEmailChange(r, user.id, newest, () => false),
      ]);
      expect(races.filter((result) => result === undefined)).toHaveLength(1);
      expect(races).toContain("invalid");
      expect((await r.users.get(user.id))?.email).toBe("second@example.org");
      expect(await checkEmailToken(r, reset, "reset-password")).toBeUndefined();
      expect(await pendingEmailChange(r, user.id, newest)).toBeUndefined();

      expect(await send("claimed@example.org")).toBeUndefined();
      await r.users.create({ username: "Ewa", email: "Claimed@example.org", status: "active" });
      expect(await confirmEmailChange(r, user.id, issued[2]!, () => false)).toBe("taken");
      expect((await r.users.get(user.id))?.email).toBe("second@example.org");
    });

    it("resets a password, ending every session, and activates a pending account", async () => {
      const u = await r.users.create({ username: "retro_fan", email: "fan@example.org", status: "pending" });
      await r.credentials.set(u.id, "argon2id", "x");
      const { token: session } = await startSession(r, u.id, { userAgent: "", ip: "" });
      const link = await issueEmailToken(r, u.id, "reset-password");
      expect(await resetPassword(r, link, "short")).toEqual({ ok: false, error: "too-short" });
      const done = await resetPassword(r, link, "a brand new passphrase");
      expect(done.ok && done.user.status).toBe("active");
      expect(await resolveSession(r, session)).toBeNull();
      expect((await authenticate(r, "retro_fan", "a brand new passphrase")).ok).toBe(true);
      expect(await resetPassword(r, link, "another new passphrase")).toEqual({
        ok: false,
        error: "invalid-link",
      });
    });

    it("says an unverified account is unverified only to someone who knows its password", async () => {
      const reg = await register(
        r,
        { disallowedUsernames: [], rulesVersion: 1, verifyEmail: true },
        { username: "Nowy", email: "nowy@example.org", password: "correct horse", acceptRules: true },
      );
      expect(reg.ok && reg.user.status).toBe("pending");
      expect(await authenticate(r, "Nowy", "wrong horse!")).toEqual({ ok: false, reason: "invalid" });
      expect(await authenticate(r, "Nowy", "correct horse")).toMatchObject({
        ok: false,
        reason: "unverified",
      });
    });

    it("shares throttle counts through the database", async () => {
      const policy = { free: 2, baseMs: 1000, maxMs: 4000, windowMs: 60_000 };
      const replicaA = new Throttle(policy, r.throttle, "login");
      const replicaB = new Throttle(policy, r.throttle, "login");
      await Promise.all([replicaA.fail("ola", 0), replicaB.fail("ola", 0)]);
      expect(await replicaA.wait("ola", 0)).toBe(1000);
      expect(await r.throttle.purge(1)).toBe(1);
      expect(await replicaB.wait("ola", 0)).toBe(0);
    });
  });
});
