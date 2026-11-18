// SPDX-License-Identifier: AGPL-3.0-or-later
// Moderation (M2 slice 2) on every engine: lock, move, split, merge, delete, bans.
import {
  banUser,
  coreRegistry,
  createTopic,
  deleteTopic,
  findBan,
  installCorePermissions,
  loadSnapshot,
  lockTopic,
  mergeTopics,
  moveTopic,
  type Permissions,
  permissionsFor,
  type Repositories,
  reply,
  splitTopic,
  type User,
  viewerFor,
  wildcardMatch,
} from "@postmodem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./database.ts";
import { openTestDatabase, testEngines } from "./testing.ts";

const RULES = { floodSeconds: 0, maxLength: 1000 };

describe.each(testEngines())("moderation on %s", (engine) => {
  let db: Database;
  let r: Repositories;
  let a: Awaited<ReturnType<Repositories["nodes"]["create"]>>;
  let b: typeof a;
  let mod: User;
  let member: User;
  const perms = async (u: User | null): Promise<Permissions> =>
    permissionsFor(coreRegistry(), await loadSnapshot(r), await viewerFor(r, u?.id ?? null));
  /** A topic by the member with `replies` replies, returned with its post ids. */
  async function topic(nodeId: number, title: string, replies: number) {
    const t = await createTopic(r, await perms(member), member, { nodeId, title, source: "first" }, RULES);
    if (!t.ok) throw new Error(t.problem);
    const ids = [t.post.id];
    for (let i = 0; i < replies; i++) {
      const re = await reply(
        r,
        await perms(member),
        member,
        { topicId: t.topic.id, source: `reply ${i}` },
        RULES,
      );
      if (!re.ok) throw new Error(re.problem);
      ids.push(re.post.id);
    }
    return { id: t.topic.id, posts: ids };
  }

  beforeEach(async () => {
    db = await openTestDatabase(engine);
    await db.migrate();
    r = db.repos;
    await installCorePermissions(r);
    a = await r.nodes.create({ parentId: null, kind: "forum", title: "A" });
    b = await r.nodes.create({ parentId: null, kind: "forum", title: "B" });
    mod = await r.users.create({ username: "mod", email: null });
    member = await r.users.create({ username: "member", email: null });
    const role = (await r.roles.byKey("core:moderator"))!;
    await r.grants.create(role.id, { type: "user", id: mod.id }, a.id);
    await r.grants.create(role.id, { type: "user", id: mod.id }, b.id);
  });
  afterEach(async () => {
    await db.close();
  });

  it("locks only for moderators, and writes the reason to the audit log", async () => {
    const t = await topic(a.id, "T", 0);
    expect(await lockTopic(r, await perms(member), member, t.id, true, "")).toEqual({
      ok: false,
      problem: "forbidden",
    });
    expect(await lockTopic(r, await perms(mod), mod, t.id, true, "spam")).toMatchObject({
      ok: true,
      topic: { locked: true },
    });
    expect((await r.audit.recent(1))[0]).toMatchObject({
      actorId: mod.id,
      action: "moderation.locked",
      details: { reason: "spam" },
    });
  });

  it("moves a topic, leaving a shadow, with both forums recounted", async () => {
    const t = await topic(a.id, "T", 2);
    const moved = await moveTopic(r, await perms(mod), mod, t.id, b.id, { shadow: true, reason: "" });
    expect(moved).toMatchObject({ ok: true, topic: { nodeId: b.id } });
    expect(await r.nodes.get(a.id)).toMatchObject({ topicCount: 0, postCount: 0 });
    expect(await r.nodes.get(b.id)).toMatchObject({ topicCount: 1, postCount: 3 });
    const shadow = (await r.topics.listByNode(a.id, { page: 1, perPage: 10 })).items;
    expect(shadow).toHaveLength(1);
    expect(shadow[0]?.movedToTopicId).toBe(t.id);
    expect(
      await moveTopic(r, await perms(mod), mod, t.id, b.id, { shadow: false, reason: "" }),
    ).toMatchObject({ problem: "same-forum" });
  });

  it("splits selected posts into a new topic, and refuses to move all or none", async () => {
    const t = await topic(a.id, "T", 3);
    const p = await perms(mod);
    expect(await splitTopic(r, p, mod, { topicId: t.id, postIds: [], title: "x", reason: "" })).toMatchObject(
      { problem: "nothing-selected" },
    );
    expect(
      await splitTopic(r, p, mod, { topicId: t.id, postIds: t.posts, title: "x", reason: "" }),
    ).toMatchObject({ problem: "nothing-selected" });
    const split = await splitTopic(r, p, mod, {
      topicId: t.id,
      postIds: t.posts.slice(2),
      title: "Odłączony",
      targetNodeId: b.id,
      reason: "off-topic",
    });
    if (!split.ok) throw new Error(split.problem);
    expect(split.topic).toMatchObject({
      nodeId: b.id,
      title: "Odłączony",
      replyCount: 1,
      firstPostId: t.posts[2],
    });
    expect(await r.topics.get(t.id)).toMatchObject({ replyCount: 1, lastPostId: t.posts[1] });
    expect(await r.nodes.get(a.id)).toMatchObject({ topicCount: 1, postCount: 2 });
    expect(await r.nodes.get(b.id)).toMatchObject({ topicCount: 1, postCount: 2 });
  });

  it("merges a topic into another, leaving the source as a shadow that points there", async () => {
    const one = await topic(a.id, "One", 1);
    const two = await topic(b.id, "Two", 0);
    const merged = await mergeTopics(r, await perms(mod), mod, one.id, two.id, "duplicate");
    expect(merged).toMatchObject({ ok: true, topic: { id: two.id, replyCount: 2 } });
    expect(await r.topics.get(one.id)).toMatchObject({ movedToTopicId: two.id, replyCount: 0 });
    expect(await r.nodes.get(a.id)).toMatchObject({ topicCount: 0, postCount: 0 });
    expect(await r.nodes.get(b.id)).toMatchObject({ topicCount: 1, postCount: 3 });
    expect(await mergeTopics(r, await perms(mod), mod, two.id, two.id, "")).toMatchObject({
      problem: "invalid",
    });
  });

  it("deletes a topic and takes its posts out of the posters' counts", async () => {
    const t = await topic(a.id, "T", 2);
    expect((await r.users.get(member.id))?.postCount).toBe(3);
    expect(await deleteTopic(r, await perms(mod), mod, t.id, "")).toMatchObject({ ok: true });
    expect((await r.users.get(member.id))?.postCount).toBe(0);
    expect(await r.nodes.get(a.id)).toMatchObject({ topicCount: 0, postCount: 0 });
  });

  it("bans users, IPs and e-mail addresses, with wildcards and expiry", async () => {
    await r.sessions.create({
      id: "s",
      userId: member.id,
      createdAt: 1,
      lastSeenAt: 1,
      expiresAt: Date.now() + 60_000,
      userAgent: "",
      ip: "",
    });
    const ban = await banUser(r, mod, member.id, { reason: "spam", expiresAt: null });
    expect(ban).toMatchObject({ kind: "user", value: String(member.id) });
    expect(await r.sessions.listForUser(member.id)).toEqual([]);
    expect(await banUser(r, mod, mod.id, { reason: "", expiresAt: null })).toBeNull();
    await r.bans.create({ kind: "ip", value: "10.0.*", reason: "", createdBy: mod.id, expiresAt: null });
    await r.bans.create({
      kind: "email",
      value: "*@spam.example",
      reason: "",
      createdBy: mod.id,
      expiresAt: null,
    });
    await r.bans.create({
      kind: "ip",
      value: "192.0.2.1",
      reason: "",
      createdBy: mod.id,
      expiresAt: Date.now() - 1,
    });
    const active = await r.bans.active(Date.now());
    expect(active).toHaveLength(3);
    expect(findBan(active, { userId: member.id })?.kind).toBe("user");
    expect(findBan(active, { ip: "10.0.3.4" })?.kind).toBe("ip");
    expect(findBan(active, { ip: "192.0.2.1" })).toBeUndefined(); // expired
    expect(findBan(active, { email: "Bot@SPAM.example" })?.kind).toBe("email");
    expect(findBan(active, { userId: mod.id, ip: "10.1.0.1", email: "a@b.c" })).toBeUndefined();
    expect(wildcardMatch("10.0.*", "10.0.0.1")).toBe(true);
    expect(wildcardMatch("10.0.*", "110.0.0.1")).toBe(false);
  });

  it("invites: usable while they have uses left and haven't expired, used up one at a time", async () => {
    const now = Date.now();
    const inv = await r.invites.create({
      codeHash: "h1",
      createdBy: mod.id,
      expiresAt: now + 60_000,
      usesLeft: 2,
      note: "beta",
    });
    await r.invites.create({ codeHash: "h2", createdBy: null, expiresAt: now - 1, usesLeft: 5, note: "" });
    expect(await r.invites.usable("h1", now)).toMatchObject({ id: inv.id, usesLeft: 2 });
    expect(await r.invites.usable("h2", now)).toBeUndefined();
    expect(await r.invites.usable("nope", now)).toBeUndefined();
    expect(await r.invites.consume(inv.id)).toBe(true);
    expect(await r.invites.consume(inv.id)).toBe(true);
    expect(await r.invites.consume(inv.id)).toBe(false);
    expect(await r.invites.usable("h1", now)).toBeUndefined();
    expect((await r.invites.list()).length).toBe(2);
    await r.invites.remove(inv.id);
    expect((await r.invites.list()).length).toBe(1);
  });
});
