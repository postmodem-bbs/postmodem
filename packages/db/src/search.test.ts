// SPDX-License-Identifier: AGPL-3.0-or-later
// The database's full-text index (M2 slice 6) on every engine.
import { foldForSearch, type Repositories, searchTerms } from "@postmodem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./database.ts";
import { openTestDatabase, testEngines } from "./testing.ts";

describe("search terms", () => {
  it("fold Polish letters, drop punctuation and short words, and cap the count", () => {
    expect(foldForSearch("Zażółć GĘŚLĄ jaźń, Łódź!")).toBe("zazolc gesla jazn lodz");
    expect(searchTerms('a Łódź łódź "x" OR ) * 486')).toEqual(["lodz", "or", "486"]);
    expect(searchTerms("a b c d e f g h i j k l m n o p").length).toBe(0);
    expect(searchTerms("aa bb cc dd ee ff gg hh ii jj")).toHaveLength(8);
  });
});

describe.each(testEngines())("search on %s", (engine) => {
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

  it("finds posts by every word, as prefixes, only in the given forums and public posts", async () => {
    const a = await r.nodes.create({ parentId: null, kind: "forum", title: "A" });
    const b = await r.nodes.create({ parentId: null, kind: "forum", title: "B" });
    const u = await r.users.create({ username: "u", email: null });
    const post = async (nodeId: number, title: string, body: string, at: number) => {
      const t = await r.topics.create({ nodeId, title, authorId: u.id });
      const p = await r.posts.create({
        topicId: t.id,
        authorId: u.id,
        source: body,
        format: "bbcode-phpbb2",
        createdAt: at,
      });
      await r.search.index([
        {
          postId: p.id,
          topicId: t.id,
          nodeId,
          authorId: u.id,
          createdAt: at,
          title: foldForSearch(title),
          body: foldForSearch(body),
        },
      ]);
      return p;
    };
    const p1 = await post(a.id, "Zasilacz AT", "Szukam zasilacza do 486 z Łodzi", 1000);
    const p2 = await post(a.id, "Karta graficzna", "Zasilacz też się przyda", 2000);
    const hidden = await post(b.id, "Zasilacz w ukrytym forum", "tajne", 3000);
    const page = { page: 1, perPage: 10 };
    const q = (text: string, nodeIds = [a.id], authorId?: number) =>
      r.search.query({ terms: searchTerms(text), nodeIds, authorId, page });

    expect((await q("zasil")).items).toEqual([p2.id, p1.id]); // newest first, prefix match
    expect((await q("zasilacz 486")).items).toEqual([p1.id]); // every word
    // Diacritics don't matter either way: "łódź" and "lodz" both find "Łodzi".
    expect((await q("łódź")).items).toEqual([p1.id]);
    expect((await q("lodz")).items).toEqual([p1.id]);
    expect((await q("zasilacz", [a.id, b.id])).items).toEqual([hidden.id, p2.id, p1.id]);
    expect((await q("zasilacz", [])).items).toEqual([]);
    expect((await q("zasilacz", [a.id], 999)).items).toEqual([]);
    expect((await q("graficzna")).items).toEqual([p2.id]); // titles count

    // Deleted posts drop out; re-indexing replaces a document.
    await r.posts.setVisibility(p1.id, "core:deleted");
    expect((await q("486")).items).toEqual([]);
    await r.search.index([
      {
        postId: p2.id,
        topicId: p2.topicId,
        nodeId: a.id,
        authorId: u.id,
        createdAt: 2000,
        title: "nowy",
        body: "inny tekst",
      },
    ]);
    expect((await q("przyda")).items).toEqual([]);
    expect((await q("inny")).items).toEqual([p2.id]);
    // Nothing that looks like query syntax gets through.
    expect((await r.search.query({ terms: ['zas" OR "', "x)*"], nodeIds: [a.id], page })).items).toEqual([]);
    await r.search.clear();
    expect((await q("inny")).total).toBe(0);
  });
});
