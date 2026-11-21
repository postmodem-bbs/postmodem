// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { createLogger, searchTerms } from "@postmodem/core";
import { openTestDatabase, testEngines } from "@postmodem/db/testing";
import { describe, expect, it } from "vitest";
import { Meilisearch } from "./meilisearch.ts";
import { rebuildSearch } from "./search.ts";

const url = process.env.PM_TEST_MEILI_URL;
const key = process.env.PM_TEST_MEILI_KEY;

describe.runIf(url)("Meilisearch", () => {
  it.each(testEngines())(
    "rebuilds, checks stale matches and retries writes on %s",
    async (engine) => {
      const db = await openTestDatabase(engine);
      const index = `test-${randomUUID()}`;
      const config = { searchUrl: `${url}/${index}`, searchKey: key };
      const endpoint = new URL(config.searchUrl).host;
      const log = createLogger({ level: "error" });
      const provider = new Meilisearch(config, db, log);
      const rejected = new Meilisearch({ ...config, searchKey: "wrong-key-for-tests" }, db, log);
      const { repos, kysely } = db;
      const sync = async (search: Meilisearch) => {
        search.start();
        await search.stop();
      };

      try {
        await db.migrate();
        const forum = await repos.nodes.create({ parentId: null, kind: "forum", title: "Public" });
        const other = await repos.nodes.create({ parentId: null, kind: "forum", title: "Restricted" });
        const member = await repos.users.create({ username: "Szukający", email: null });
        const topic = await repos.topics.create({ nodeId: forum.id, title: "Retro", authorId: member.id });
        const add = (source: string, createdAt: number) =>
          repos.posts.create({
            topicId: topic.id,
            authorId: member.id,
            source,
            format: "bbcode-phpbb2",
            createdAt,
          });
        const first = await add("Zażółć Amiga [quote]quoted[/quote] [hide]secret[/hide]", 1000);
        const second = await add("Amiga retro", 2000);
        const q = (text: string, nodeIds = [forum.id], authorId?: number, page = 1) => ({
          terms: searchTerms(text),
          nodeIds,
          authorId,
          page: { page, perPage: 1 },
        });
        const find = (...args: Parameters<typeof q>) => provider.query(q(...args));

        expect(await kysely.selectFrom("searchDirty").selectAll().execute()).toEqual([]);
        // Built-in search has no documents yet, so these hits must come from Meilisearch.
        await provider.rebuild();
        expect(await find("amig")).toMatchObject({ total: 2, items: [second.id] });
        expect(await find("amig", [forum.id], member.id, 2)).toMatchObject({ total: 2, items: [first.id] });
        expect((await find("amiga zazol")).items).toEqual([first.id]);
        expect((await find("amiga", [other.id])).total).toBe(0);
        expect((await find("amiga", [forum.id], member.id + 1)).total).toBe(0);
        const rawDocument = async () =>
          fetch(`http://${endpoint}/indexes/${index}/documents/${first.id}`, {
            headers: key ? { authorization: `Bearer ${key}` } : {},
          });
        expect(await (await rawDocument()).json()).toMatchObject({ body: "zazolc amiga" });

        await repos.topics.moveTo(topic.id, other.id);
        expect((await find("amiga")).total).toBe(0);
        await sync(provider);
        expect((await find("amiga", [other.id])).total).toBe(2);

        await repos.posts.edit(first.id, { source: "Commodore", editedAt: 3000, editCount: 1 });
        expect((await find("zazol", [other.id])).total).toBe(0);
        await sync(rejected);
        expect(await kysely.selectFrom("searchDirty").select("postId").execute()).toHaveLength(1);
        await sync(provider);
        expect((await find("commodore", [other.id])).items).toEqual([first.id]);

        const third = await add("Atari", 4000);
        await sync(provider);
        expect((await find("atari", [other.id])).items).toEqual([third.id]);
        await rebuildSearch(repos);
        expect((await rejected.query(q("commodore", [other.id]))).items).toEqual([first.id]);

        await repos.topics.setVisibility(topic.id, "core:deleted");
        expect((await find("commodore", [other.id])).total).toBe(0);
        await sync(provider);
        const removed = await rawDocument();
        expect(removed.status).toBe(404);
        await removed.body?.cancel();
      } finally {
        await db.close();
        const cleanup = await fetch(`http://${endpoint}/indexes/${index}`, {
          method: "DELETE",
          headers: key ? { authorization: `Bearer ${key}` } : {},
        });
        await cleanup.body?.cancel();
      }
    },
    30_000,
  );
});
