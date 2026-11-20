// SPDX-License-Identifier: AGPL-3.0-or-later
import { openTestDatabase } from "@postmodem/db/testing";
import { expect, it } from "vitest";
import { indexPosts, searchPlan } from "./search.ts";

it("indexes sanitized public contributions and excludes protected text from snippets", async () => {
  const db = await openTestDatabase("sqlite");
  try {
    await db.migrate();
    const r = db.repos;
    const node = await r.nodes.create({ parentId: null, kind: "forum", title: "Forum" });
    const topic = await r.topics.create({ nodeId: node.id, authorId: null, title: "Topic" });
    const post = await r.posts.create({
      topicId: topic.id,
      authorId: null,
      format: "bbcode-phpbb2",
      source: "public [hide]hiddenword[/hide] [code]extraneous[/code]",
    });
    const plan = searchPlan([
      [
        "example",
        {
          version: 1,
          omitTags: ["hide", "code"],
          async fields(docs) {
            expect(docs[0]?.body).toBe("public");
            return new Map([[post.id, { body: "addition [hide]notindexed[/hide]" }]]);
          },
          filters: () => [{ field: "postId", op: "eq", value: post.id }],
        },
      ],
    ]);
    await indexPosts(r, [post], plan);
    const query = (word: string) =>
      r.search.query({
        terms: [word],
        nodeIds: [node.id],
        filters: plan.filters(new URLSearchParams()),
        page: { page: 1, perPage: 10 },
      });
    expect((await query("addition")).items).toEqual([post.id]);
    for (const word of ["hiddenword", "extraneous", "notindexed"])
      expect((await query(word)).items).toEqual([]);
    expect(plan.excerpt(post.source, 140)).toBe("public");

    await r.posts.setVisibility(post.id, "core:deleted");
    // Stale callers cannot reinsert content that was hidden after they loaded it.
    await indexPosts(r, [post], plan);
    expect((await query("addition")).items).toEqual([]);
  } finally {
    await db.close();
  }
});
