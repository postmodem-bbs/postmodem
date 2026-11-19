// SPDX-License-Identifier: AGPL-3.0-or-later
// Counters (PLATFORM-SERVICES §8, M2b slice 10): numbers that go up a lot (views, clicks,
// impressions) and must never slow a page down. Hits collect in a buffer (process memory
// in solo, Valkey shared by every replica when configured) and reach the database in one
// batch every few seconds. Documented as approximate: a crash loses at most one interval.
import type { Millis } from "../domain/types.ts";

export type CounterPeriod = "total" | "day";

export interface CounterDef {
  /** `<package>.<name>`, e.g. `core.topicViews`. */
  key: string;
  periods: CounterPeriod[];
  /**
   * Where totals go instead of the shared counter table (the core's topic views keep
   * living in `topics.views`, which listings sort by). Only for the `total` period.
   */
  flushTotal?(key: string, by: number): Promise<void>;
}

const KEY = /^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9]*$/;

export function defineCounter(def: CounterDef): CounterDef {
  if (!KEY.test(def.key)) throw new Error(`invalid counter key '${def.key}': expected <package>.<name>`);
  if (!def.periods.length) throw new Error(`counter '${def.key}' needs at least one period`);
  if (def.flushTotal && def.periods.some((p) => p !== "total"))
    throw new Error(`counter '${def.key}': flushTotal counters count totals only`);
  return def;
}

/** One buffered amount: counter, entity key, period and its bucket (a UTC day, or ""). */
export interface CounterCell {
  counter: string;
  key: string;
  period: CounterPeriod;
  bucket: string;
}
const SEP = "\u001f";
export const cellField = (c: CounterCell) => [c.counter, c.key, c.period, c.bucket].join(SEP);
export function parseCell(field: string): CounterCell {
  const [counter = "", key = "", period = "total", bucket = ""] = field.split(SEP);
  return { counter, key, period: period as CounterPeriod, bucket };
}
export const dayBucket = (now: Millis) => new Date(now).toISOString().slice(0, 10);

/** Where hits wait for the next flush. Memory (one process) or Valkey (every replica). */
export interface CounterBuffer {
  readonly kind: "memory" | "valkey";
  add(field: string, by: number): void | Promise<void>;
  /** Takes everything buffered so far (atomically, when shared between replicas). */
  take(): Promise<Map<string, number>>;
  /** Puts amounts back after a failed write. */
  giveBack(batch: Map<string, number>): Promise<void>;
  /** Amounts not yet flushed, for these fields (so a page shows its own view straight away). */
  peek(fields: string[]): Promise<Map<string, number>>;
  close(): Promise<void>;
}

export class MemoryCounterBuffer implements CounterBuffer {
  readonly kind = "memory" as const;
  #pending = new Map<string, number>();
  add(field: string, by: number) {
    this.#pending.set(field, (this.#pending.get(field) ?? 0) + by);
  }
  async take() {
    const batch = this.#pending;
    this.#pending = new Map();
    return batch;
  }
  async giveBack(batch: Map<string, number>) {
    for (const [f, by] of batch) this.add(f, by);
  }
  async peek(fields: string[]) {
    return new Map(fields.flatMap((f) => (this.#pending.has(f) ? [[f, this.#pending.get(f)!]] : [])));
  }
  async close() {}
}

/** Port: flushed totals (implemented in @postmodem/db as `ext_counters`). */
export interface CounterStore {
  add(rows: (CounterCell & { by: number })[]): Promise<void>;
  read(counter: string, keys: string[], period: CounterPeriod, bucket: string): Promise<Map<string, number>>;
}

export const COUNTER_FLUSH_MS = 10_000;

export class Counters {
  readonly #defs = new Map<string, CounterDef>();
  readonly #buffer: CounterBuffer;
  readonly #store: CounterStore;
  readonly #onError: (e: unknown) => void;
  readonly #now: () => Millis;
  #flushing: Promise<void> | undefined;

  constructor(
    buffer: CounterBuffer,
    store: CounterStore,
    opts: { onError?: (e: unknown) => void; now?: () => Millis } = {},
  ) {
    this.#buffer = buffer;
    this.#store = store;
    this.#onError = opts.onError ?? (() => {});
    this.#now = opts.now ?? Date.now;
  }

  get transport() {
    return this.#buffer.kind;
  }

  register(...defs: CounterDef[]): this {
    for (const d of defs) {
      if (this.#defs.has(d.key)) throw new Error(`counter '${d.key}' is already registered`);
      this.#defs.set(d.key, d);
    }
    return this;
  }

  #def(key: string) {
    const def = this.#defs.get(key);
    if (!def) throw new Error(`unknown counter '${key}'`);
    return def;
  }

  #cells(def: CounterDef, key: string, now: Millis): CounterCell[] {
    return def.periods.map((period) => ({
      counter: def.key,
      key,
      period,
      bucket: period === "day" ? dayBucket(now) : "",
    }));
  }

  /** Counts one hit (never throws: a counter must not break the page that counts). */
  hit(counter: string, key: string | number, by = 1): void {
    try {
      const def = this.#def(counter);
      for (const cell of this.#cells(def, String(key), this.#now()))
        void Promise.resolve(this.#buffer.add(cellField(cell), by)).catch(this.#onError);
    } catch (e) {
      this.#onError(e);
    }
  }

  /** Hits not yet flushed, per key (for the `total` period). */
  async pending(counter: string, keys: (string | number)[]): Promise<Map<string, number>> {
    const fields = keys.map((k) => cellField({ counter, key: String(k), period: "total", bucket: "" }));
    const got = await this.#buffer.peek(fields);
    return new Map(keys.map((k, i) => [String(k), got.get(fields[i]!) ?? 0]));
  }

  /** Flushed plus pending values (counters kept in the shared table). */
  async read(
    counter: string,
    keys: (string | number)[],
    period: CounterPeriod = "total",
    now: Millis = this.#now(),
  ): Promise<Map<string, number>> {
    const bucket = period === "day" ? dayBucket(now) : "";
    const ids = keys.map(String);
    const [stored, pending] = await Promise.all([
      this.#store.read(counter, ids, period, bucket),
      this.#buffer.peek(ids.map((key) => cellField({ counter, key, period, bucket }))),
    ]);
    return new Map(
      ids.map((key) => [
        key,
        (stored.get(key) ?? 0) + (pending.get(cellField({ counter, key, period, bucket })) ?? 0),
      ]),
    );
  }

  /** Writes everything buffered so far. Failed writes go back into the buffer. */
  flush(): Promise<void> {
    this.#flushing ??= (async () => {
      let batch: Map<string, number>;
      try {
        batch = await this.#buffer.take();
      } catch (e) {
        this.#onError(e);
        return;
      }
      const shared: (CounterCell & { by: number })[] = [];
      const failed = new Map<string, number>();
      for (const [field, by] of batch) {
        const cell = parseCell(field);
        const def = this.#defs.get(cell.counter);
        if (!def || !by) continue; // a counter whose package is gone: its hits go with it
        if (def.flushTotal) {
          try {
            await def.flushTotal(cell.key, by);
          } catch (e) {
            failed.set(field, by);
            this.#onError(e);
          }
        } else shared.push({ ...cell, by });
      }
      if (shared.length) {
        try {
          await this.#store.add(shared);
        } catch (e) {
          for (const r of shared) failed.set(cellField(r), r.by);
          this.#onError(e);
        }
      }
      if (failed.size) await this.#buffer.giveBack(failed).catch(this.#onError);
    })().finally(() => {
      this.#flushing = undefined;
    });
    return this.#flushing;
  }

  start(intervalMs = COUNTER_FLUSH_MS): () => void {
    const timer = setInterval(() => void this.flush(), intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  async close() {
    await this.flush();
    await this.#buffer.close();
  }
}
