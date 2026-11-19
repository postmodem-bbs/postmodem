// SPDX-License-Identifier: AGPL-3.0-or-later
// Stores for the platform services (M2b slice 10): preferences, entity fields, collections'
// documents and flushed counters. JSON is kept as text on both engines.
import type {
  CounterStore,
  Doc,
  DocState,
  DocStore,
  FieldStore,
  FieldTarget,
  PreferenceStore,
} from "@postmodem/core";
import type { Kysely } from "kysely";
import type { Schema } from "./schema.ts";

const FIELD_TABLES = {
  user: "fieldValuesUser",
  forum: "fieldValuesForum",
  topic: "fieldValuesTopic",
  post: "fieldValuesPost",
} as const satisfies Record<FieldTarget, keyof Schema>;

/** Large id lists are read in chunks (SQLite's bound-parameter limit). */
const CHUNK = 500;
const chunks = <T>(xs: T[]) =>
  Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));

export function preferenceStore(db: Kysely<Schema>): PreferenceStore {
  return {
    async load(userId) {
      const rows = await db
        .selectFrom("userPreferences")
        .select(["key", "value"])
        .where("userId", "=", userId)
        .execute();
      return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
    },
    async save(userId, key, value) {
      const json = JSON.stringify(value);
      await db
        .insertInto("userPreferences")
        .values({ userId, key, value: json })
        .onConflict((oc) => oc.columns(["userId", "key"]).doUpdateSet({ value: json }))
        .execute();
    },
    async remove(userId, key) {
      await db.deleteFrom("userPreferences").where("userId", "=", userId).where("key", "=", key).execute();
    },
    async deleteAll(userId) {
      await db.deleteFrom("userPreferences").where("userId", "=", userId).execute();
    },
  };
}

function typed(value: unknown) {
  return {
    vText: typeof value === "string" ? value : null,
    vInt: typeof value === "number" && Number.isSafeInteger(value) ? value : null,
    vNum: typeof value === "number" ? value : null,
    vBool: typeof value === "boolean" ? (value ? 1 : 0) : null,
    vJson: JSON.stringify(value),
  };
}

export function fieldStore(db: Kysely<Schema>): FieldStore {
  return {
    async load(target, ids, keys) {
      const out = new Map<number, Record<string, unknown>>();
      if (!ids.length || !keys.length) return out;
      const table = FIELD_TABLES[target];
      for (const part of chunks([...new Set(ids)])) {
        const rows = await db
          .selectFrom(table)
          .select(["entityId", "field", "vJson"])
          .where("entityId", "in", part)
          .where("field", "in", keys)
          .execute();
        for (const r of rows) {
          const id = Number(r.entityId);
          const values = out.get(id) ?? {};
          values[r.field] = JSON.parse(r.vJson);
          out.set(id, values);
        }
      }
      return out;
    },
    async save(target, id, key, value) {
      const row = typed(value);
      await db
        .insertInto(FIELD_TABLES[target])
        .values({ entityId: id, field: key, ...row })
        .onConflict((oc) => oc.columns(["entityId", "field"]).doUpdateSet(row))
        .execute();
    },
    async remove(target, id, key) {
      await db.deleteFrom(FIELD_TABLES[target]).where("entityId", "=", id).where("field", "=", key).execute();
    },
    async removeEntity(target, id) {
      await db.deleteFrom(FIELD_TABLES[target]).where("entityId", "=", id).execute();
    },
  };
}

type DocRow = Schema["extDocs"];
const toDoc = (r: DocRow): Doc => ({
  id: r.id,
  collection: r.collection,
  scope: r.scope === null ? null : Number(r.scope),
  author: r.author === null ? null : Number(r.author),
  created: Number(r.created),
  updated: Number(r.updated),
  state: r.state as DocState,
  data: JSON.parse(r.data),
});

export function docStore(db: Kysely<Schema>): DocStore {
  return {
    async list(collection, scope, opts) {
      let q = db
        .selectFrom("extDocs")
        .selectAll()
        .where("collection", "=", collection)
        .where("state", "in", opts.states)
        .where("scope", scope === null ? "is" : "=", scope);
      if (opts.before) q = q.where("id", opts.order === "newest" ? "<" : ">", opts.before);
      const rows = await q
        .orderBy("id", opts.order === "newest" ? "desc" : "asc")
        .limit(opts.limit)
        .execute();
      return rows.map(toDoc);
    },
    async get(collection, id) {
      const r = await db
        .selectFrom("extDocs")
        .selectAll()
        .where("collection", "=", collection)
        .where("id", "=", id)
        .executeTakeFirst();
      return r && toDoc(r);
    },
    async insert(doc) {
      await db
        .insertInto("extDocs")
        .values({ ...doc, data: JSON.stringify(doc.data) })
        .execute();
    },
    async update(collection, id, patch) {
      await db
        .updateTable("extDocs")
        .set({
          updated: patch.updated,
          ...(patch.state ? { state: patch.state } : {}),
          ...(patch.data !== undefined ? { data: JSON.stringify(patch.data) } : {}),
        })
        .where("collection", "=", collection)
        .where("id", "=", id)
        .execute();
    },
    async remove(collection, id) {
      await db.deleteFrom("extDocs").where("collection", "=", collection).where("id", "=", id).execute();
    },
    async countByAuthor(collection, author, since) {
      const r = await db
        .selectFrom("extDocs")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("author", "=", author)
        .where("collection", "=", collection)
        .where("created", ">=", since)
        .executeTakeFirstOrThrow();
      return Number(r.n);
    },
    async purge(collection, opts) {
      let removed = 0;
      if (opts.olderThan !== undefined) {
        const r = await db
          .deleteFrom("extDocs")
          .where("collection", "=", collection)
          .where("created", "<", opts.olderThan)
          .executeTakeFirst();
        removed += Number(r.numDeletedRows);
      }
      if (opts.keep !== undefined) {
        const r = await db
          .deleteFrom("extDocs")
          .where("collection", "=", collection)
          .where("id", "not in", (eb) =>
            eb
              .selectFrom("extDocs")
              .select("id")
              .where("collection", "=", collection)
              .orderBy("id", "desc")
              .limit(opts.keep!),
          )
          .executeTakeFirst();
        removed += Number(r.numDeletedRows);
      }
      return removed;
    },
    async byAuthor(author) {
      const rows = await db
        .selectFrom("extDocs")
        .selectAll()
        .where("author", "=", author)
        .orderBy("id")
        .execute();
      return rows.map(toDoc);
    },
    async removeByAuthor(author) {
      const r = await db.deleteFrom("extDocs").where("author", "=", author).executeTakeFirst();
      return Number(r.numDeletedRows);
    },
  };
}

export function counterStore(db: Kysely<Schema>): CounterStore {
  return {
    async add(rows) {
      // One statement per cell keeps it portable; flushes are small and every few seconds.
      await db.transaction().execute(async (tx) => {
        for (const r of rows) {
          await tx
            .insertInto("extCounters")
            .values({ counter: r.counter, key: r.key, period: r.period, bucket: r.bucket, value: r.by })
            .onConflict((oc) =>
              oc
                .columns(["counter", "key", "period", "bucket"])
                .doUpdateSet((eb) => ({ value: eb("extCounters.value", "+", eb.ref("excluded.value")) })),
            )
            .execute();
        }
      });
    },
    async read(counter, keys, period, bucket) {
      const out = new Map<string, number>();
      for (const part of chunks([...new Set(keys)])) {
        if (!part.length) continue;
        const rows = await db
          .selectFrom("extCounters")
          .select(["key", "value"])
          .where("counter", "=", counter)
          .where("period", "=", period)
          .where("bucket", "=", bucket)
          .where("key", "in", part)
          .execute();
        for (const r of rows) out.set(r.key, Number(r.value));
      }
      return out;
    },
  };
}
