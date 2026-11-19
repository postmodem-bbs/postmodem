// SPDX-License-Identifier: AGPL-3.0-or-later
// Collections (PLATFORM-SERVICES §6, M2b slice 10): small document stores a package declares
// instead of writing its own tables and endpoints: shoutbox messages, announcements, nav
// links. Authors and timestamps are set by the server; every write is schema-validated,
// rule-checked and rate-limited, and announced on the package's channel. Rules are
// TypeScript in v0; the tier-1 manifest's CEL rules compile to the same shape in M4.
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import type { Permissions } from "../domain/core-permissions.ts";
import type { Id, Millis } from "../domain/types.ts";

export type DocState = "visible" | "hidden" | "deleted";

export interface Doc<T = Record<string, unknown>> {
  /** ULID: sorts by creation time. */
  id: string;
  collection: string;
  /** The forum, topic or user the document belongs to; null for board-wide collections. */
  scope: Id | null;
  author: Id | null;
  created: Millis;
  updated: Millis;
  state: DocState;
  data: T;
}

export interface RuleContext {
  perms: Permissions;
  scope: Id | null;
  now: Millis;
}

export interface CollectionDef<T extends Record<string, unknown>> {
  /** `<package>.<name>`, e.g. `shoutbox.messages`. */
  key: string;
  scope: "board" | "node" | "topic" | "user";
  schema: z.ZodType<T>;
  rules: {
    list(c: RuleContext): boolean;
    create(c: RuleContext, input: T): boolean;
    update?(c: RuleContext, doc: Doc<T>, input: T): boolean;
    delete?(c: RuleContext, doc: Doc<T>): boolean;
    /** May see hidden documents and hide or show them (the moderation integration). */
    moderate?(c: RuleContext): boolean;
  };
  /** Newest first (default) or oldest first. */
  order?: "newest" | "oldest";
  /** Retention, applied by the scheduler's housekeeping. */
  retention?: { maxAgeDays?: number; maxDocs?: number };
  /** Creations per author (or per guest IP) per minute; default 10. */
  createsPerMinute?: number;
  /** Channel (`<package>.<name>`) that hears about every write. */
  channel?: string;
  /** The `data` fields that are personal (export and erase). */
  personal?: (keyof T & string)[];
}

const KEY = /^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9]*$/;

export function defineCollection<T extends Record<string, unknown>>(def: CollectionDef<T>): CollectionDef<T> {
  if (!KEY.test(def.key)) throw new Error(`invalid collection key '${def.key}': expected <package>.<name>`);
  return def;
}

/** Limits per document and per page (PLATFORM-SERVICES §6.6). */
export const DOC_MAX_BYTES = 64 * 1024;
export const LIST_MAX = 200;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** A ULID: 48 bits of time, 80 random bits, Crockford base32 (sortable as text). */
export function ulid(now: Millis = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i]! % 32];
  return time + rand;
}

/** Port: the shared document table (implemented in @postmodem/db). */
export interface DocStore {
  list(
    collection: string,
    scope: Id | null,
    opts: { limit: number; before?: string; order: "newest" | "oldest"; states: DocState[] },
  ): Promise<Doc[]>;
  get(collection: string, id: string): Promise<Doc | undefined>;
  insert(doc: Doc): Promise<void>;
  update(
    collection: string,
    id: string,
    patch: { data?: unknown; state?: DocState; updated: Millis },
  ): Promise<void>;
  remove(collection: string, id: string): Promise<void>;
  /** Documents by this author created since `since` (rate limit). */
  countByAuthor(collection: string, author: Id, since: Millis): Promise<number>;
  /** Retention: drops documents older than `olderThan` and beyond the newest `keep`. */
  purge(collection: string, opts: { olderThan?: Millis; keep?: number }): Promise<number>;
  /** Every document a member wrote, in any collection (export). */
  byAuthor(author: Id): Promise<Doc[]>;
  /** Hard-deletes a member's documents (account deletion). */
  removeByAuthor(author: Id): Promise<number>;
}

export type CollectionEvent = "created" | "updated" | "deleted";

export type CollectionErrorCode = "not-found" | "denied" | "invalid" | "rate-limited";

export class CollectionError extends Error {
  readonly code: CollectionErrorCode;
  constructor(code: CollectionErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export class Collections {
  readonly #defs = new Map<string, CollectionDef<Record<string, unknown>>>();
  readonly #store: DocStore;
  readonly #announce: (def: CollectionDef<Record<string, unknown>>, event: CollectionEvent, doc: Doc) => void;

  constructor(
    store: DocStore,
    announce: (
      def: CollectionDef<Record<string, unknown>>,
      event: CollectionEvent,
      doc: Doc,
    ) => void = () => {},
  ) {
    this.#store = store;
    this.#announce = announce;
  }

  // biome-ignore lint/suspicious/noExplicitAny: each collection has its own document type
  register(...defs: CollectionDef<any>[]): this {
    for (const d of defs) {
      if (this.#defs.has(d.key)) throw new Error(`collection '${d.key}' is already registered`);
      this.#defs.set(d.key, d);
    }
    return this;
  }

  definition(key: string) {
    return this.#defs.get(key);
  }

  all() {
    return [...this.#defs.values()];
  }

  #def(key: string) {
    const def = this.#defs.get(key);
    if (!def) throw new CollectionError("not-found", `unknown collection '${key}'`);
    return def;
  }

  #parse(def: CollectionDef<Record<string, unknown>>, input: unknown) {
    const parsed = def.schema.safeParse(input);
    if (!parsed.success)
      throw new CollectionError(
        "invalid",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    if (Buffer.byteLength(JSON.stringify(parsed.data)) > DOC_MAX_BYTES)
      throw new CollectionError("invalid", "document too large");
    return parsed.data;
  }

  async list(key: string, c: RuleContext, opts: { limit?: number; before?: string } = {}): Promise<Doc[]> {
    const def = this.#def(key);
    if (!def.rules.list(c)) throw new CollectionError("denied", "not allowed to read this collection");
    const states: DocState[] = def.rules.moderate?.(c) ? ["visible", "hidden"] : ["visible"];
    return this.#store.list(key, def.scope === "board" ? null : c.scope, {
      limit: Math.min(Math.max(opts.limit ?? 30, 1), LIST_MAX),
      ...(opts.before ? { before: opts.before } : {}),
      order: def.order ?? "newest",
      states,
    });
  }

  async create(key: string, c: RuleContext, input: unknown): Promise<Doc> {
    const def = this.#def(key);
    const data = this.#parse(def, input);
    if (!def.rules.list(c) || !def.rules.create(c, data))
      throw new CollectionError("denied", "not allowed to add to this collection");
    const author = c.perms.viewer.userId;
    if (author !== null) {
      const recent = await this.#store.countByAuthor(key, author, c.now - 60_000);
      if (recent >= (def.createsPerMinute ?? 10))
        throw new CollectionError("rate-limited", "too many, too fast");
    }
    const doc: Doc = {
      id: ulid(c.now),
      collection: key,
      scope: def.scope === "board" ? null : c.scope,
      author,
      created: c.now,
      updated: c.now,
      state: "visible",
      data,
    };
    await this.#store.insert(doc);
    this.#announce(def, "created", doc);
    return doc;
  }

  async #existing(def: CollectionDef<Record<string, unknown>>, c: RuleContext, id: string) {
    const doc = await this.#store.get(def.key, id);
    const canModerate = def.rules.moderate?.(c) ?? false;
    const scope = def.scope === "board" ? null : c.scope;
    if (
      !doc ||
      doc.scope !== scope ||
      doc.state === "deleted" ||
      (doc.state === "hidden" && !canModerate) ||
      !def.rules.list(c)
    )
      throw new CollectionError("not-found", "no such document");
    return { doc, canModerate };
  }

  async update(key: string, c: RuleContext, id: string, input: unknown): Promise<Doc> {
    const def = this.#def(key);
    const { doc } = await this.#existing(def, c, id);
    const data = this.#parse(def, input);
    if (!def.rules.update?.(c, doc, data)) throw new CollectionError("denied", "not allowed to change this");
    await this.#store.update(key, id, { data, updated: c.now });
    const next = { ...doc, data, updated: c.now };
    this.#announce(def, "updated", next);
    return next;
  }

  async remove(key: string, c: RuleContext, id: string): Promise<void> {
    const def = this.#def(key);
    const { doc } = await this.#existing(def, c, id);
    if (!def.rules.delete?.(c, doc)) throw new CollectionError("denied", "not allowed to delete this");
    await this.#store.remove(key, id);
    this.#announce(def, "deleted", doc);
  }

  /** Moderators hide a document (it stays, readers stop seeing it) or show it again. */
  async setHidden(key: string, c: RuleContext, id: string, hidden: boolean): Promise<void> {
    const def = this.#def(key);
    const { doc, canModerate } = await this.#existing(def, c, id);
    if (!canModerate) throw new CollectionError("denied", "not allowed to moderate this collection");
    const state: DocState = hidden ? "hidden" : "visible";
    await this.#store.update(key, id, { state, updated: c.now });
    this.#announce(def, "updated", { ...doc, state, updated: c.now });
  }

  /** Housekeeping: every collection's retention. */
  async applyRetention(now: Millis = Date.now()): Promise<number> {
    let removed = 0;
    for (const def of this.#defs.values()) {
      const r = def.retention;
      if (!r?.maxAgeDays && !r?.maxDocs) continue;
      removed += await this.#store.purge(def.key, {
        ...(r.maxAgeDays ? { olderThan: now - r.maxAgeDays * 86_400_000 } : {}),
        ...(r.maxDocs ? { keep: r.maxDocs } : {}),
      });
    }
    return removed;
  }
}
