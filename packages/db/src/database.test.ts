// SPDX-License-Identifier: AGPL-3.0-or-later
// One behavioural suite, run on every engine (ADR 0013): SQLite, PGlite, and a real
// Postgres server when PM_TEST_PG_URL is set.
import { boardName, coreSettings, type Repositories, Settings, TreeError } from "@postmodem/core";
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
      await r.ranks.create({ title: "Nowicjusz", minPosts: 0, special: false, image: null });
      await r.ranks.create({ title: "Admin", minPosts: null, special: true, image: null });
      expect((await r.ranks.all()).map((x) => x.title)).toEqual(["Admin", "Nowicjusz"]);
      await r.smilies.create({ code: ":-)", image: "icon_smile.gif", emotion: "Smile", position: 1 });
      await expect(
        r.smilies.create({ code: ":-)", image: "x.gif", emotion: "", position: 2 }),
      ).rejects.toThrow();
      expect(await r.smilies.all()).toHaveLength(1);
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
});
