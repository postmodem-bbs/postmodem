// SPDX-License-Identifier: AGPL-3.0-or-later
import { setTimeout as delay } from "node:timers/promises";
import type { Config, Id, Logger, Repositories, SearchDocument } from "@postmodem/core";
import type { Database } from "@postmodem/db";
import { searchDocuments } from "./search.ts";

const BATCH_SIZE = 200;
const MAX_HITS = 1001;
const LEASE_MS = 60_000;
type SearchQuery = Parameters<Repositories["search"]["query"]>[0];

async function publicSearchDocuments(repos: Repositories, ids: Id[]): Promise<SearchDocument[]> {
  const posts = [...(await repos.posts.getMany(ids)).values()].filter(
    (post) => post.visibility === "core:public",
  );
  const topics = await repos.topics.getMany([...new Set(posts.map((post) => post.topicId))]);
  return searchDocuments(
    posts.filter((post) => topics.get(post.topicId)?.visibility === "core:public"),
    topics,
  );
}

/** External search stores a derived index. The database remains the authority for each hit. */
export class Meilisearch {
  readonly #base: string;
  readonly #index: string;
  readonly #key: string | undefined;
  readonly #db: Database;
  readonly #log: Logger;
  #running: Promise<void> | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(config: Pick<Config, "searchUrl" | "searchKey">, db: Database, log: Logger) {
    const url = new URL(config.searchUrl);
    this.#base = `${url.protocol === "meilisearchs:" ? "https" : "http"}://${url.host}`;
    this.#index = `/indexes/${url.pathname.slice(1) || "postmodem"}`;
    this.#key = config.searchKey;
    this.#db = db;
    this.#log = log;
  }

  async #request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(this.#base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.#key ? { authorization: `Bearer ${this.#key}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Meilisearch returned HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  async #task(path: string, method: string, body?: unknown): Promise<void> {
    const { taskUid } = await this.#request<{ taskUid: number }>(path, method, body);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const { status, error } = await this.#request<{ status: string; error?: { code: string } }>(
        `/tasks/${taskUid}`,
      );
      if (status === "succeeded") return;
      if (status === "failed" || status === "canceled")
        throw new Error(`Meilisearch task ${status}${error ? ` (${error.code})` : ""}`);
      await delay(100);
    }
    throw new Error("Meilisearch task timed out");
  }

  async query(q: SearchQuery): ReturnType<Repositories["search"]["query"]> {
    const { repos, kysely } = this.#db;
    const start = (q.page.page - 1) * q.page.perPage;
    const page = (items: Id[], total: number) => ({
      ...q.page,
      items,
      total,
      pages: Math.max(1, Math.ceil(total / q.page.perPage)),
    });
    if (!q.nodeIds.length || !q.terms.length || start >= MAX_HITS) return page([], 0);
    const state = await kysely
      .selectFrom("searchSync")
      .select("ready")
      .where("id", "=", 1)
      .executeTakeFirst();
    if (!state?.ready) return repos.search.query(q);

    let candidates: Id[];
    try {
      const result = await this.#request<{ hits: { postId: Id }[] }>(`${this.#index}/search`, "POST", {
        q: q.terms.join(" "),
        filter: [
          `nodeId IN [${q.nodeIds.join(",")}]`,
          ...(q.authorId == null ? [] : [`authorId = ${q.authorId}`]),
        ],
        matchingStrategy: "all",
        sort: ["createdAt:desc", "postId:desc"],
        attributesToRetrieve: ["postId"],
        limit: MAX_HITS,
      });
      candidates = result.hits.map((hit) => hit.postId);
    } catch (e) {
      this.#log.warn("Meilisearch query failed; using database search", { error: (e as Error).message });
      return repos.search.query(q);
    }

    // Ignore stale matches, including removed text and old forum/author assignments. Use
    // only verified hits for the count as well as the page, since counts can also leak data.
    const nodes = new Set(q.nodeIds);
    const matches: SearchDocument[] = [];
    for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
      const docs = await publicSearchDocuments(repos, candidates.slice(offset, offset + BATCH_SIZE));
      for (const doc of docs) {
        if (!nodes.has(doc.nodeId) || (q.authorId != null && q.authorId !== doc.authorId)) continue;
        const words = `${doc.title} ${doc.body}`.split(" ");
        if (
          q.terms.every((term, i) =>
            i === q.terms.length - 1 ? words.some((word) => word.startsWith(term)) : words.includes(term),
          )
        )
          matches.push(doc);
      }
    }
    matches.sort((a, b) => b.createdAt - a.createdAt || b.postId - a.postId);
    return page(
      matches.slice(start, start + q.page.perPage).map((doc) => doc.postId),
      matches.length,
    );
  }

  start(): void {
    if (this.#timer) return;
    const tick = () => {
      this.#running ??= this.#sync()
        .catch((e) => this.#log.warn("Meilisearch sync failed; will retry", { error: (e as Error).message }))
        .finally(() => {
          this.#running = undefined;
        });
    };
    this.#timer = setInterval(tick, 5_000);
    this.#timer.unref();
    tick();
  }

  async stop(): Promise<void> {
    clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#running;
  }

  // A database lease serializes replicas and CLI rebuilds without holding a transaction
  // during network requests. Each renewal covers one bounded operation.
  async #lease(work: (renew: () => Promise<void>) => Promise<void>): Promise<boolean> {
    const state = this.#db.kysely.updateTable("searchSync").where("id", "=", 1);
    const now = Date.now();
    let heldUntil = now + LEASE_MS;
    const acquired = await state
      .set({ leaseUntil: heldUntil })
      .where("leaseUntil", "<=", now)
      .executeTakeFirst();
    if (!acquired.numUpdatedRows) return false;
    const renew = async () => {
      const next = Date.now() + LEASE_MS;
      const result = await state
        .set({ leaseUntil: next })
        .where("leaseUntil", "=", heldUntil)
        .executeTakeFirst();
      if (!result.numUpdatedRows) throw new Error("Meilisearch sync lease expired");
      heldUntil = next;
    };
    try {
      await work(renew);
      return true;
    } finally {
      await state.set({ leaseUntil: 0 }).where("leaseUntil", "=", heldUntil).execute();
    }
  }

  async #flush(renew: () => Promise<void>): Promise<boolean> {
    const { kysely, repos } = this.#db;
    const dirty = await kysely
      .selectFrom("searchDirty")
      .selectAll()
      .orderBy("postId")
      .limit(BATCH_SIZE)
      .execute();
    if (!dirty.length) return false;
    const ids = dirty.map((row) => Number(row.postId));
    const docs = await publicSearchDocuments(repos, ids);
    const indexed = new Set(docs.map((d) => d.postId));
    const deleted = ids.filter((id) => !indexed.has(id));
    if (docs.length) await this.#task(`${this.#index}/documents?primaryKey=postId`, "POST", docs);
    if (deleted.length) await this.#task(`${this.#index}/documents/delete-batch`, "POST", deleted);
    await renew();
    // A write concurrent with this batch increments its revision. Keep those rows for retry.
    await kysely
      .deleteFrom("searchDirty")
      .where((eb) => eb.or(dirty.map(({ postId, revision }) => eb.and({ postId, revision }))))
      .execute();
    return true;
  }

  async #sync(): Promise<void> {
    const { kysely } = this.#db;
    const state = await kysely
      .selectFrom("searchSync")
      .select("ready")
      .where("id", "=", 1)
      .executeTakeFirst();
    if (!state?.ready) return;
    const pending = await kysely.selectFrom("searchDirty").select("postId").limit(1).executeTakeFirst();
    if (pending)
      await this.#lease(async (renew) => {
        await this.#flush(renew);
      });
  }

  async rebuild(): Promise<void> {
    const { kysely } = this.#db;
    await kysely
      .insertInto("searchSync")
      .values({ id: 1, ready: 0, leaseUntil: 0 })
      .onConflict((oc) => oc.doNothing())
      .execute();
    const acquired = await this.#lease(async (renew) => {
      const state = kysely.updateTable("searchSync").where("id", "=", 1);
      await state.set({ ready: 0 }).execute();
      await this.#task(`${this.#index}/settings`, "PATCH", {
        searchableAttributes: ["title", "body"],
        filterableAttributes: ["nodeId", "authorId"],
        sortableAttributes: ["createdAt", "postId"],
        rankingRules: ["sort"],
        typoTolerance: { enabled: false },
        pagination: { maxTotalHits: MAX_HITS },
      });
      await renew();
      await this.#task(`${this.#index}/documents`, "DELETE");
      await renew();
      await kysely
        .insertInto("searchDirty")
        .columns(["postId"])
        .expression((eb) => eb.selectFrom("posts").select("id").where("id", ">", 0).orderBy("id"))
        .onConflict((oc) => oc.doNothing())
        .execute();
      do {
        await renew();
      } while (await this.#flush(renew));
      await state.set({ ready: 1 }).execute();
    });
    if (!acquired) throw new Error("Meilisearch sync is active; retry the rebuild shortly");
  }
}
