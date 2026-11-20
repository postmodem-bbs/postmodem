// SPDX-License-Identifier: AGPL-3.0-or-later
// The first-party packages on every engine: their migrations, stores and decorations.
import {
  coreRegistry,
  coreSettings,
  createTopic,
  deletePost,
  deleteTopic,
  editPost,
  installCorePermissions,
  loadSnapshot,
  packageRoleGrants,
  permissionsFor,
  type Repositories,
  reply,
  Settings,
  type User,
  viewerFor,
} from "@postmodem/core";
import type { Database } from "@postmodem/db";
import { openTestDatabase, testEngines } from "@postmodem/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editPolicy } from "./edit-policy.ts";
import { INSTALLED_PACKAGES, reportsFor, reportsStore, revisionsStore, unreadStore } from "./index.ts";
import { revisions } from "./revisions.ts";
import { restoreTrashedTopic, TRASHED, trashBin, trashDestination } from "./trash-bin.ts";
import { unreadTracking } from "./unread-tracking.ts";

const RULES = { floodSeconds: 0, maxLength: 1000 };
const caps = INSTALLED_PACKAGES.flatMap((p) => p.capabilities ?? []);

describe.each(testEngines())("first-party packages on %s", (engine) => {
  let db: Database;
  let r: Repositories;
  let alice: User;
  let bob: User;
  let forum: Awaited<ReturnType<Repositories["nodes"]["create"]>>;
  const perms = async (u: User | null) =>
    permissionsFor(coreRegistry(caps), await loadSnapshot(r), await viewerFor(r, u?.id ?? null));

  beforeEach(async () => {
    db = await openTestDatabase(engine);
    await db.migrate();
    const migrations = Object.fromEntries(
      INSTALLED_PACKAGES.flatMap((p) =>
        Object.entries(p.migrations?.(db.dialect) ?? {}).map(([n, m]) => [`${p.key}/${n}`, m]),
      ),
    );
    expect(await db.migratePackages(migrations)).toEqual(Object.keys(migrations).sort());
    expect(await db.migratePackages(migrations)).toEqual([]);
    r = db.repos;
    await installCorePermissions(r, {
      capabilities: caps,
      roleGrants: packageRoleGrants(INSTALLED_PACKAGES),
    });
    forum = await r.nodes.create({ parentId: null, kind: "forum", title: "F" });
    alice = await r.users.create({ username: "alice", email: null });
    bob = await r.users.create({ username: "bob", email: null });
  });
  afterEach(async () => {
    await db.close();
  });

  it("trashes moderator deletes, keeps them private, and restores their counts", async () => {
    const trash = await r.nodes.create({ parentId: null, kind: "forum", title: "Trash" });
    await r.fields.save("forum", forum.id, trashDestination.key, trash.id);
    await r.grants.create(
      (await r.roles.byKey("core:moderator"))!.id,
      { type: "user", id: bob.id },
      forum.id,
    );
    const mod = await perms(bob);
    const hooks = (await trashBin.setup!({} as never)).content;
    const created = await createTopic(
      r,
      await perms(alice),
      alice,
      { nodeId: forum.id, title: "Topic", source: "first" },
      RULES,
    );
    if (!created.ok) throw new Error(created.problem);
    const response = await reply(
      r,
      await perms(alice),
      alice,
      { topicId: created.topic.id, source: "second" },
      RULES,
    );
    if (!response.ok) throw new Error(response.problem);
    await r.search.index([
      {
        postId: response.post.id,
        topicId: created.topic.id,
        nodeId: forum.id,
        authorId: alice.id,
        createdAt: response.post.createdAt,
        title: "topic",
        body: "second",
      },
    ]);

    const result = await deletePost(r, mod, bob, response.post.id, { hooks });
    expect(result).toMatchObject({ ok: true, topicDeleted: false, topic: { id: created.topic.id } });
    const moved = (await r.posts.get(response.post.id))!;
    expect(moved.topicId).not.toBe(created.topic.id);
    expect(await r.topics.get(moved.topicId)).toMatchObject({ nodeId: trash.id, visibility: TRASHED });
    expect((await r.topics.listByNode(trash.id, { page: 1, perPage: 10 })).total).toBe(0);
    expect(
      (
        await r.search.query({
          terms: ["second"],
          nodeIds: [forum.id, trash.id],
          page: { page: 1, perPage: 10 },
        })
      ).total,
    ).toBe(0);
    expect(await r.nodes.get(forum.id)).toMatchObject({ topicCount: 1, postCount: 1 });
    expect(await r.nodes.get(trash.id)).toMatchObject({ topicCount: 0, postCount: 0 });

    const shadow = await r.topics.create({
      nodeId: forum.id,
      title: "Moved topic",
      authorId: alice.id,
      movedToTopicId: created.topic.id,
    });
    expect(await deleteTopic(r, mod, bob, created.topic.id, "cleanup", hooks)).toMatchObject({
      ok: true,
      topic: { nodeId: trash.id, visibility: TRASHED },
    });
    expect(await deleteTopic(r, mod, bob, created.topic.id, "retry")).toMatchObject({ ok: false });
    expect(await r.users.get(alice.id)).toMatchObject({ postCount: 0 });
    expect((await r.topics.listByNode(forum.id, { page: 1, perPage: 10 })).items).toEqual([]);
    expect(await restoreTrashedTopic(r, created.topic.id, forum.id, bob.id)).toBe(true);
    expect(await restoreTrashedTopic(r, created.topic.id, forum.id, bob.id)).toBe(false);
    expect(await r.topics.get(created.topic.id)).toMatchObject({
      nodeId: forum.id,
      visibility: "core:public",
    });
    expect(await r.users.get(alice.id)).toMatchObject({ postCount: 1 });
    expect(
      (await r.topics.listByNode(forum.id, { page: 1, perPage: 10 })).items.map((topic) => topic.id),
    ).toContain(shadow.id);
    expect(await deleteTopic(r, mod, bob, created.topic.id, "package disabled")).toMatchObject({
      ok: true,
      topic: { nodeId: forum.id, visibility: "core:deleted" },
    });
  });

  it("reports: members may report, only moderators of the forum see the queue", async () => {
    const t = await createTopic(
      r,
      await perms(alice),
      alice,
      { nodeId: forum.id, title: "x", source: "y" },
      RULES,
    );
    if (!t.ok) throw new Error(t.problem);
    expect((await perms(bob)).can("reports.create", forum)).toBe(true);
    expect((await perms(null)).can("reports.create", forum)).toBe(false);
    const store = reportsStore(db.kysely.withoutPlugins());
    const rep = await store.create({ postId: t.post.id, reporterId: bob.id, reason: "spam" });
    expect(await store.openBy(t.post.id, bob.id)).toMatchObject({ id: rep.id, status: "open" });
    expect(await reportsFor(store, r, await perms(bob))).toEqual([]);
    const mod = await r.users.create({ username: "mod", email: null });
    await r.grants.create(
      (await r.roles.byKey("core:moderator"))!.id,
      { type: "user", id: mod.id },
      forum.id,
    );
    const queue = await reportsFor(store, r, await perms(mod));
    expect(queue.map((q) => q.report.id)).toEqual([rep.id]);
    await store.close(rep.id, mod.id, "removed");
    expect(await store.open()).toEqual([]);
    expect(await store.get(rep.id)).toMatchObject({ status: "closed", outcome: "removed", closedBy: mod.id });
  });

  it("unread-tracking: new posts mark topics and forums until read, per member", async () => {
    const settings = new Settings(coreSettings().register(...(unreadTracking.settings ?? [])), {
      loadAll: async () => new Map(),
      save: async () => {},
    });
    await settings.init();
    const runtime = await unreadTracking.setup!({
      repos: r,
      db: db.kysely.withoutPlugins(),
      settings,
      log: console as never,
      fields: {} as never,
      collections: {} as never,
      channels: {} as never,
      counters: {} as never,
      isEnabled: () => true,
    });
    const t = await createTopic(
      r,
      await perms(alice),
      alice,
      { nodeId: forum.id, title: "x", source: "y" },
      RULES,
    );
    if (!t.ok) throw new Error(t.problem);
    const bobView = { userId: bob.id, groupIds: [] };
    const topics = async () => [(await r.topics.get(t.topic.id))!];
    expect((await runtime.decorateTopics!(bobView, await topics())).has(t.topic.id)).toBe(true);
    expect((await runtime.decorateForums!(bobView, [forum])).has(forum.id)).toBe(true);
    // Guests have no read state.
    expect((await runtime.decorateTopics!({ userId: null, groupIds: [] }, await topics())).size).toBe(0);

    await new Promise((ok) => setTimeout(ok, 5));
    await runtime.on!["topic.viewed"]!({ topic: t.topic, viewer: bobView, lastPostAt: t.topic.lastPostAt });
    expect((await runtime.decorateTopics!(bobView, await topics())).size).toBe(0);
    expect((await runtime.decorateForums!(bobView, [forum])).size).toBe(0);

    // A reply makes it unread again; "mark all read" clears it.
    await new Promise((ok) => setTimeout(ok, 5));
    await reply(r, await perms(alice), alice, { topicId: t.topic.id, source: "z" }, RULES);
    expect((await runtime.decorateTopics!(bobView, await topics())).size).toBe(1);
    await new Promise((ok) => setTimeout(ok, 5));
    await unreadStore(db.kysely.withoutPlugins()).markNode(bob.id, 0, Date.now());
    expect((await runtime.decorateTopics!(bobView, await topics())).size).toBe(0);
    expect((await runtime.decorateForums!(bobView, [forum])).size).toBe(0);
  });

  const setupOf = async (pkg: typeof revisions, values: Record<string, unknown> = {}) => {
    const settings = new Settings(coreSettings().register(...(pkg.settings ?? [])), {
      loadAll: async () => new Map(Object.entries(values)),
      save: async () => {},
    });
    await settings.init();
    return pkg.setup!({
      repos: r,
      db: db.kysely.withoutPlugins(),
      settings,
      log: console as never,
      fields: {} as never,
      collections: {} as never,
      channels: {} as never,
      counters: {} as never,
      isEnabled: () => true,
    });
  };

  it("revisions: every edit keeps the replaced text, in the edit's transaction", async () => {
    const runtime = await setupOf(revisions);
    const hooks = runtime.content!;
    const t = await createTopic(
      r,
      await perms(alice),
      alice,
      { nodeId: forum.id, title: "x", source: "one" },
      RULES,
    );
    if (!t.ok) throw new Error(t.problem);
    const edit = (source: string, extra: object = {}) =>
      editPost(
        r,
        perms_alice,
        alice,
        { postId: t.post.id, source },
        { ...RULES, hooks: { ...hooks, ...extra } },
      );
    const perms_alice = await perms(alice);
    expect((await edit("two")).ok).toBe(true);
    expect((await edit("two")).ok).toBe(true); // unchanged text: nothing to keep
    expect((await edit("three")).ok).toBe(true);
    const store = revisionsStore(db.kysely.withoutPlugins());
    expect((await store.forPost(t.post.id)).map((v) => v.body)).toEqual(["two", "one"]);
    expect((await store.forPost(t.post.id))[0]!.editedBy).toBe(alice.id);

    // A veto stops the edit; a hook that throws rolls the whole edit back.
    const vetoed = await edit("four", {
      beforeUpdate: async () => ({ veto: { package: "x", code: "no" } }),
    });
    expect(vetoed).toMatchObject({ ok: false, problem: "refused", refusal: { package: "x", code: "no" } });
    await expect(
      edit("five", {
        postUpdated: async (e: Parameters<NonNullable<typeof hooks.postUpdated>>[0], tx: Repositories) => {
          await hooks.postUpdated!(e, tx);
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    expect((await r.posts.get(t.post.id))!.source).toBe("three");
    expect(await store.forPost(t.post.id)).toHaveLength(2);

    // Who sees the history: moderators; the author while the board allows it; not others.
    const actions = (u: User | null) =>
      perms(u).then((p) =>
        runtime.postActions!({ viewer: p.viewer, perms: p, user: u, node: forum }, [t.post]),
      );
    expect((await actions(alice)).get(t.post.id)?.[0]).toMatchObject({ key: "revisions", count: 2 });
    expect((await actions(bob)).size).toBe(0);
    expect(await runtime.housekeeping!(Date.now())).toBe(0); // kept forever by default
  });

  it("edit-policy: a time limit on own posts, and admins' posts protected from moderators", async () => {
    const runtime = await setupOf(editPolicy, { "edit-policy.windowMinutes": 15 });
    const hooks = runtime.content!;
    const mod = await r.users.create({ username: "mod", email: null });
    const admin = await r.users.create({ username: "root", email: null });
    const roles = new Map((await r.roles.all()).map((x) => [x.key, x.id]));
    await r.grants.create(roles.get("core:moderator")!, { type: "user", id: mod.id }, null);
    await r.grants.create(roles.get("core:admin")!, { type: "user", id: admin.id }, null);
    const start = Date.UTC(2026, 10, 19, 12);
    const post = async (u: User) => {
      const t = await createTopic(
        r,
        await perms(u),
        u,
        { nodeId: forum.id, title: "x", source: "y" },
        { ...RULES, now: start },
      );
      if (!t.ok) throw new Error(t.problem);
      return t.post.id;
    };
    const edit = async (u: User, postId: number, minutes: number) =>
      editPost(
        r,
        await perms(u),
        u,
        { postId, source: "changed" },
        { ...RULES, hooks, now: start + minutes * 60_000 },
      );

    const mine = await post(alice);
    expect((await edit(alice, mine, 10)).ok).toBe(true);
    expect(await edit(alice, mine, 20)).toMatchObject({
      problem: "refused",
      refusal: { package: "edit-policy", code: "window-closed", params: { minutes: 15 } },
    });
    expect((await edit(mod, mine, 20)).ok).toBe(true); // moderators aren't bound by the window

    const admins = await post(admin);
    expect(await edit(mod, admins, 1)).toMatchObject({ refusal: { code: "admin-post" } });
    expect((await edit(admin, admins, 1)).ok).toBe(true);
    expect(await deletePost(r, await perms(mod), mod, admins, { hooks, now: start + 60_000 })).toMatchObject({
      refusal: { code: "admin-post" },
    });
  });
});
