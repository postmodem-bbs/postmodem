// SPDX-License-Identifier: AGPL-3.0-or-later
// The first-party packages on every engine: their migrations, stores and decorations.
import {
  coreRegistry,
  coreSettings,
  createTopic,
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
import { INSTALLED_PACKAGES, reportsFor, reportsStore, unreadStore } from "./index.ts";
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
});
