// SPDX-License-Identifier: AGPL-3.0-or-later
// N+1 guard (M1 risks): every listing page runs the same number of SQL statements whether
// the board is tiny or many times bigger. A loop that queries per forum, topic, post or
// author makes the counts differ and fails here, long before it shows up in production.
import {
  coreRegistry,
  installCorePermissions,
  loadSnapshot,
  type Permissions,
  permissionsFor,
  type Repositories,
  viewerFor,
} from "@postmodem/core";
import { openTestDatabase } from "@postmodem/db/testing";
import { describe, expect, it } from "vitest";
import { POSTS_PER_PAGE, TOPICS_PER_PAGE } from "../pagination.ts";
import { loadForum, loadIndex, loadTopic } from "./board.ts";
import { createRenderer } from "./content.ts";

interface Size {
  forums: number;
  topics: number;
  posts: number;
  users: number;
}

async function board(size: Size) {
  let queries = 0;
  const db = await openTestDatabase("sqlite", { onQuery: () => void queries++ });
  await db.migrate();
  const r = db.repos;
  await installCorePermissions(r);
  const users = [];
  for (let i = 0; i < size.users; i++)
    users.push(await r.users.create({ username: `user${i}`, email: null }));
  const now = Date.now();
  for (const u of users)
    await r.sessions.create({
      id: `s${u.id}`,
      userId: u.id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + 60_000,
      userAgent: "",
      ip: "",
    });
  const cat = await r.nodes.create({ parentId: null, kind: "category", title: "Category" });
  const forums = [];
  for (let f = 0; f < size.forums; f++) {
    const forum = await r.nodes.create({ parentId: cat.id, kind: "forum", title: `Forum ${f}` });
    await r.nodes.create({ parentId: forum.id, kind: "forum", title: `Sub ${f}` });
    forums.push(forum);
  }
  const big = forums[0]!;
  let topicId = 0;
  for (const forum of forums)
    for (let t = 0; t < (forum === big ? size.topics : 1); t++) {
      const topic = await r.topics.create({
        nodeId: forum.id,
        title: `Topic ${t}`,
        authorId: users[t % users.length]!.id,
      });
      topicId ||= topic.id;
      for (let p = 0; p < (topic.id === topicId ? size.posts : 1); p++)
        await r.posts.create({
          topicId: topic.id,
          authorId: users[p % users.length]!.id,
          source: `[b]Post ${p}[/b] :-)`,
          format: "bbcode-phpbb2",
        });
      await r.topics.recount(topic.id);
    }
  for (const n of await r.nodes.tree()) await r.nodes.recount(n.id);
  const perms: Permissions = permissionsFor(
    coreRegistry(),
    await loadSnapshot(r),
    await viewerFor(r, users[0]!.id),
  );
  const renderer = createRenderer(r);
  const views = { add() {}, pending: () => 0 };
  const topic = (await r.topics.get(topicId))!;
  const lastTopics = Math.floor((size.topics - 1) / TOPICS_PER_PAGE) * TOPICS_PER_PAGE;
  const lastPosts = Math.floor((size.posts - 1) / POSTS_PER_PAGE) * POSTS_PER_PAGE;
  // Rendering caches posts on first view; warm it up so both boards measure cached reads.
  await loadTopic(r, perms, (p) => renderer.render(p), views, topic, 0);
  await loadTopic(r, perms, (p) => renderer.render(p), views, topic, lastPosts);
  const count = async (fn: (r: Repositories) => Promise<unknown>) => {
    queries = 0;
    expect(await fn(r)).toBeTruthy();
    return queries;
  };
  const counts = {
    index: await count(() => loadIndex(r, perms)),
    forumFirst: await count(() => loadForum(r, perms, big, 0)),
    forumLast: await count(() => loadForum(r, perms, big, lastTopics)),
    topicFirst: await count(() => loadTopic(r, perms, (p) => renderer.render(p), views, topic, 0)),
    topicLast: await count(() => loadTopic(r, perms, (p) => renderer.render(p), views, topic, lastPosts)),
  };
  await db.close();
  return counts;
}

describe("listing pages", () => {
  it("run a fixed number of queries, however big the board", async () => {
    const small = await board({ forums: 1, topics: 2, posts: 2, users: 2 });
    const large = await board({ forums: 6, topics: 60, posts: 40, users: 12 });
    expect(large).toEqual(small);
    // And the fixed numbers stay small (raise deliberately if a page needs more).
    for (const [page, n] of Object.entries(large)) expect(n, page).toBeLessThanOrEqual(15);
  }, 60_000);
});
