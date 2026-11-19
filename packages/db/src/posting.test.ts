// SPDX-License-Identifier: AGPL-3.0-or-later
// Posting rules (M2 slice 1) on every engine: phpBB2's behaviour, counters kept right.
import {
  coreRegistry,
  createTopic,
  deleteAccount,
  deletePost,
  editPost,
  installCorePermissions,
  loadSnapshot,
  may,
  openMessage,
  type Permissions,
  permissionsFor,
  type Repositories,
  reply,
  sendMessage,
  type User,
  viewerFor,
} from "@postmodem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./database.ts";
import { openTestDatabase, testEngines } from "./testing.ts";

const RULES = { floodSeconds: 0, maxLength: 1000 };

describe.each(testEngines())("posting on %s", (engine) => {
  let db: Database;
  let r: Repositories;
  let forum: Awaited<ReturnType<Repositories["nodes"]["create"]>>;
  let alice: User;
  let bob: User;
  const perms = async (u: User | null): Promise<Permissions> =>
    permissionsFor(coreRegistry(), await loadSnapshot(r), await viewerFor(r, u?.id ?? null));

  beforeEach(async () => {
    db = await openTestDatabase(engine);
    await db.migrate();
    r = db.repos;
    await installCorePermissions(r); // phpBB2 defaults: everyone reads, registered users post
    forum = await r.nodes.create({ parentId: null, kind: "forum", title: "Forum" });
    alice = await r.users.create({ username: "alice", email: null });
    bob = await r.users.create({ username: "bob", email: null });
  });
  afterEach(async () => {
    await db.close();
  });

  it("starts topics and replies, keeping every counter right without a recount", async () => {
    const t = await createTopic(
      r,
      await perms(alice),
      alice,
      { nodeId: forum.id, title: "  Hej\u0007 wszystkim ", source: "Pierwszy" },
      RULES,
    );
    if (!t.ok) throw new Error(t.problem);
    expect(t.topic).toMatchObject({
      title: "Hej wszystkim",
      replyCount: 0,
      firstPostId: t.post.id,
      lastPostId: t.post.id,
    });
    const re = await reply(
      r,
      await perms(bob),
      bob,
      { topicId: t.topic.id, source: "Odpowiedź", subject: "Re: x" },
      RULES,
    );
    if (!re.ok) throw new Error(re.problem);
    expect(re.topic).toMatchObject({ replyCount: 1, lastPostId: re.post.id });
    expect(await r.nodes.get(forum.id)).toMatchObject({
      topicCount: 1,
      postCount: 2,
      lastPostId: re.post.id,
    });
    expect((await r.users.get(bob.id))?.postCount).toBe(1);
    // The incremental counters agree with a full recount.
    const recounted = await r.nodes.recount(forum.id);
    expect(recounted).toMatchObject({ topicCount: 1, postCount: 2, lastPostId: re.post.id });
  });

  it("refuses guests, empty or oversized posts, unknown forums and floods", async () => {
    const p = await perms(alice);
    expect(
      await createTopic(r, await perms(null), null, { nodeId: forum.id, title: "x", source: "y" }, RULES),
    ).toEqual({ ok: false, problem: "sign-in" });
    expect(
      await createTopic(r, p, alice, { nodeId: forum.id, title: " ", source: "y" }, RULES),
    ).toMatchObject({ problem: "title-missing" });
    expect(
      await createTopic(r, p, alice, { nodeId: forum.id, title: "x".repeat(101), source: "y" }, RULES),
    ).toMatchObject({ problem: "title-long" });
    expect(
      await createTopic(r, p, alice, { nodeId: forum.id, title: "x", source: " \n " }, RULES),
    ).toMatchObject({ problem: "body-missing" });
    expect(
      await createTopic(r, p, alice, { nodeId: forum.id, title: "x", source: "y".repeat(1001) }, RULES),
    ).toMatchObject({ problem: "body-long" });
    expect(await createTopic(r, p, alice, { nodeId: 9999, title: "x", source: "y" }, RULES)).toMatchObject({
      problem: "not-found",
    });
    expect(
      await createTopic(
        r,
        p,
        alice,
        { nodeId: forum.id, title: "x", source: "y", type: "announcement" },
        RULES,
      ),
    ).toMatchObject({ problem: "forbidden" });

    const now = Date.now();
    const flood = { floodSeconds: 15, maxLength: 1000, now };
    const t = await createTopic(r, p, alice, { nodeId: forum.id, title: "x", source: "y" }, flood);
    expect(t.ok).toBe(true);
    const again = await reply(
      r,
      p,
      alice,
      { topicId: t.ok ? t.topic.id : 0, source: "z" },
      { ...flood, now: now + 5000 },
    );
    expect(again).toEqual({ ok: false, problem: "flood", waitSeconds: 10 });
  });

  it("keeps locked topics and forums closed to members", async () => {
    const t = await createTopic(
      r,
      await perms(alice),
      alice,
      { nodeId: forum.id, title: "x", source: "y" },
      RULES,
    );
    if (!t.ok) throw new Error(t.problem);
    await r.nodes.update(forum.id, { locked: true });
    expect(await reply(r, await perms(bob), bob, { topicId: t.topic.id, source: "z" }, RULES)).toMatchObject({
      problem: "locked",
    });
    expect(
      await editPost(r, await perms(alice), alice, { postId: t.post.id, source: "z" }, RULES),
    ).toMatchObject({ problem: "locked" });
  });

  it("edits own posts only, counting an edit once someone has replied, and renames from the first post", async () => {
    const t = await createTopic(
      r,
      await perms(alice),
      alice,
      { nodeId: forum.id, title: "Old", source: "a" },
      RULES,
    );
    if (!t.ok) throw new Error(t.problem);
    expect(
      await editPost(r, await perms(bob), bob, { postId: t.post.id, source: "hacked" }, RULES),
    ).toMatchObject({ problem: "forbidden" });
    const quiet = await editPost(
      r,
      await perms(alice),
      alice,
      { postId: t.post.id, source: "b", title: "New" },
      RULES,
    );
    expect(quiet).toMatchObject({
      ok: true,
      post: { source: "b", editCount: 0, rendered: null },
      topic: { title: "New" },
    });
    await reply(r, await perms(bob), bob, { topicId: t.topic.id, source: "reply" }, RULES);
    const counted = await editPost(r, await perms(alice), alice, { postId: t.post.id, source: "c" }, RULES);
    expect(counted).toMatchObject({ ok: true, post: { editCount: 1 } });
  });

  it("deletes only the last own post; the only post takes its topic along", async () => {
    const t = await createTopic(
      r,
      await perms(alice),
      alice,
      { nodeId: forum.id, title: "x", source: "first" },
      RULES,
    );
    if (!t.ok) throw new Error(t.problem);
    const re = await reply(r, await perms(bob), bob, { topicId: t.topic.id, source: "second" }, RULES);
    if (!re.ok) throw new Error(re.problem);
    expect(await deletePost(r, await perms(alice), alice, t.post.id)).toMatchObject({
      problem: "not-last-post",
    });
    expect(await deletePost(r, await perms(alice), alice, re.post.id)).toMatchObject({
      problem: "forbidden",
    });
    expect(await deletePost(r, await perms(bob), bob, re.post.id)).toMatchObject({
      ok: true,
      topicDeleted: false,
      topic: { replyCount: 0 },
    });
    expect((await r.users.get(bob.id))?.postCount).toBe(0);
    expect(await deletePost(r, await perms(alice), alice, t.post.id)).toMatchObject({
      ok: true,
      topicDeleted: true,
    });
    expect(await r.nodes.get(forum.id)).toMatchObject({ topicCount: 0, postCount: 0, lastPostId: null });
  });

  it("offers exactly the actions the rules allow", async () => {
    const t = await createTopic(
      r,
      await perms(alice),
      alice,
      { nodeId: forum.id, title: "x", source: "a" },
      RULES,
    );
    if (!t.ok) throw new Error(t.problem);
    const re = await reply(r, await perms(bob), bob, { topicId: t.topic.id, source: "b" }, RULES);
    if (!re.ok) throw new Error(re.problem);
    const node = (await r.nodes.get(forum.id))!;
    const topic = (await r.topics.get(t.topic.id))!;
    const [pa, pb, guest] = [await perms(alice), await perms(bob), await perms(null)];
    expect(may.createTopic(pa, node)).toBe(true);
    expect(may.createTopic(guest, node)).toBe(false);
    expect(may.reply(pb, node, topic)).toBe(true);
    expect(may.edit(pa, node, topic, t.post, alice.id)).toBe(true);
    expect(may.edit(pb, node, topic, t.post, bob.id)).toBe(false);
    expect(may.delete(pa, node, topic, t.post, alice.id)).toBe(false); // not the last post
    expect(may.delete(pb, node, topic, re.post, bob.id)).toBe(true);
    await r.nodes.update(forum.id, { locked: true });
    const locked = (await r.nodes.get(forum.id))!;
    expect(may.reply(pb, locked, topic)).toBe(false);
    expect(may.createTopic(pa, locked)).toBe(false);
  });

  it("sends private messages within limits, and each side deletes its own view", async () => {
    const pm = { maxLength: 1000, inboxLimit: 2 };
    const p = await perms(alice);
    expect(await sendMessage(r, p, alice, { to: "nobody", subject: "x", source: "y" }, pm)).toEqual({
      ok: false,
      problem: "recipient-unknown",
    });
    expect(await sendMessage(r, p, alice, { to: "bob", subject: " ", source: "y" }, pm)).toMatchObject({
      problem: "subject-missing",
    });
    expect(
      await sendMessage(r, await perms(null), null, { to: "bob", subject: "x", source: "y" }, pm),
    ).toMatchObject({ problem: "sign-in" });
    const sent = await sendMessage(r, p, alice, { to: "BOB", subject: "Cześć", source: "Jak leci?" }, pm);
    if (!sent.ok) throw new Error(sent.problem);
    expect(await r.messages.unreadCount(bob.id)).toBe(1);
    expect(await openMessage(r, (await r.users.get(bob.id))!, sent.message.id)).toMatchObject({
      subject: "Cześć",
    });
    expect(await r.messages.unreadCount(bob.id)).toBe(0);
    // Nobody else can open it.
    const carol = await r.users.create({ username: "carol", email: null });
    expect(await openMessage(r, carol, sent.message.id)).toBeNull();
    await sendMessage(r, p, alice, { to: "bob", subject: "2", source: "y" }, pm);
    expect(await sendMessage(r, p, alice, { to: "bob", subject: "3", source: "y" }, pm)).toMatchObject({
      problem: "inbox-full",
    });
    expect((await r.messages.inbox(bob.id, { page: 1, perPage: 10 })).total).toBe(2);
    expect((await r.messages.sent(alice.id, { page: 1, perPage: 10 })).total).toBe(2);
    await r.messages.deleteFor(sent.message.id, bob.id);
    expect((await r.messages.inbox(bob.id, { page: 1, perPage: 10 })).total).toBe(1);
    expect(await r.messages.get(sent.message.id)).toBeDefined(); // alice still has it
    await r.messages.deleteFor(sent.message.id, alice.id);
    expect(await r.messages.get(sent.message.id)).toBeUndefined();
  });

  it("notifies each watcher once until they visit the topic again", async () => {
    const t = await createTopic(
      r,
      await perms(alice),
      alice,
      { nodeId: forum.id, title: "x", source: "a" },
      RULES,
    );
    if (!t.ok) throw new Error(t.problem);
    await r.watches.watch(alice.id, t.topic.id);
    await r.watches.watch(bob.id, t.topic.id);
    expect(await r.watches.isWatching(bob.id, t.topic.id)).toBe(true);
    expect(await r.watches.takeWatchersToNotify(t.topic.id, bob.id)).toEqual([alice.id]);
    expect(await r.watches.takeWatchersToNotify(t.topic.id, bob.id)).toEqual([]);
    await r.watches.visited(alice.id, t.topic.id);
    expect((await r.watches.takeWatchersToNotify(t.topic.id, 0)).sort()).toEqual([alice.id, bob.id].sort());
    await r.watches.unwatch(bob.id, t.topic.id);
    expect(await r.watches.isWatching(bob.id, t.topic.id)).toBe(false);
  });

  it("keeps links and private messages from new members until they have a few posts", async () => {
    const rules = { ...RULES, newMemberPosts: 2 };
    const p = await perms(alice);
    expect(
      await createTopic(
        r,
        p,
        alice,
        { nodeId: forum.id, title: "x", source: "see https://spam.example" },
        rules,
      ),
    ).toEqual({ ok: false, problem: "new-member-links" });
    expect(
      await createTopic(r, p, alice, { nodeId: forum.id, title: "x", source: "[url=x]y[/url]" }, rules),
    ).toMatchObject({ problem: "new-member-links" });
    expect(
      await sendMessage(
        r,
        p,
        alice,
        { to: "bob", subject: "x", source: "y" },
        { maxLength: 1000, inboxLimit: 0, newMemberPosts: 2 },
      ),
    ).toEqual({ ok: false, problem: "new-member" });
    const first = await createTopic(
      r,
      p,
      alice,
      { nodeId: forum.id, title: "x", source: "plain text" },
      rules,
    );
    expect(first.ok).toBe(true);
    await reply(r, p, alice, { topicId: first.ok ? first.topic.id : 0, source: "more" }, rules);
    const fresh = (await r.users.get(alice.id))!;
    expect(
      await createTopic(r, p, fresh, { nodeId: forum.id, title: "x", source: "www.example.org" }, rules),
    ).toMatchObject({ ok: true });
  });

  it("deletes an account: personal data gone, posts kept as 'Deleted user' or removed", async () => {
    const t = await createTopic(
      r,
      await perms(bob),
      bob,
      { nodeId: forum.id, title: "x", source: "bob's topic" },
      RULES,
    );
    if (!t.ok) throw new Error(t.problem);
    const re = await reply(
      r,
      await perms(alice),
      alice,
      { topicId: t.topic.id, source: "alice replies" },
      RULES,
    );
    if (!re.ok) throw new Error(re.problem);
    await sendMessage(
      r,
      await perms(alice),
      alice,
      { to: "bob", subject: "s", source: "m" },
      { maxLength: 1000, inboxLimit: 0 },
    );
    await r.watches.watch(bob.id, t.topic.id);
    await r.credentials.set(bob.id, "argon2id", "x");
    await r.users.update(bob.id, { email: "bob@example.org", location: "Kraków", signatureSource: "sig" });

    await deleteAccount(r, (await r.users.get(bob.id))!, { posts: "keep", deletedName: "Deleted user" });
    expect(await r.users.get(bob.id)).toMatchObject({
      username: `deleted-${bob.id}`,
      email: null,
      status: "deleted",
      location: "",
      signatureSource: "",
    });
    expect(await r.credentials.get(bob.id)).toBeUndefined();
    expect(await r.watches.topicsOf(bob.id)).toEqual([]);
    expect(await r.messages.allFor(bob.id)).toEqual([]);
    expect(await r.posts.get(t.post.id)).toMatchObject({
      authorId: null,
      authorName: "Deleted user",
      visibility: "core:public",
    });
    expect((await r.messages.allFor(alice.id)).length).toBe(1); // alice keeps her sent copy
    // The name is free again, the old one isn't reserved.
    expect(await r.users.byUsername("bob")).toBeUndefined();

    await deleteAccount(r, (await r.users.get(alice.id))!, { posts: "remove", deletedName: "Deleted user" });
    expect((await r.posts.get(re.post.id))?.visibility).toBe("core:deleted");
    expect(await r.topics.get(t.topic.id)).toMatchObject({ replyCount: 0, lastPostId: t.post.id });
    expect(await r.nodes.get(forum.id)).toMatchObject({ topicCount: 1, postCount: 1 });
  });
});
