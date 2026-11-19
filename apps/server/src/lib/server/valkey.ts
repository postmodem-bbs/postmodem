// SPDX-License-Identifier: AGPL-3.0-or-later
// Valkey transports for the platform services (the `scale` profile, CONTAINERS.md): a bus
// over pub/sub, and a counter buffer every replica shares, so a hit counted on one replica
// is visible on all of them before the next flush.
import { randomBytes } from "node:crypto";
import type { Bus, ChannelMessage, CounterBuffer } from "@postmodem/core";
import Valkey from "iovalkey";

const EVENTS = "pm:events";
const COUNTERS = "pm:counters";

/** iovalkey speaks redis:// URLs; valkey:// is the same protocol. */
const connect = (url: string) =>
  new Valkey(url.replace(/^valkey(s?):\/\//, "redis$1://"), {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true,
  });

export class ValkeyBus implements Bus {
  readonly kind = "valkey" as const;
  readonly #pub: Valkey;
  readonly #sub: Valkey;
  readonly #listeners = new Set<(m: ChannelMessage) => void>();
  readonly #ready: Promise<unknown>;

  constructor(url: string, onError: (e: unknown) => void = () => {}) {
    this.#pub = connect(url);
    this.#sub = connect(url);
    for (const c of [this.#pub, this.#sub]) c.on("error", onError);
    // iovalkey subscribes again by itself after a reconnect.
    this.#ready = this.#sub.subscribe(EVENTS);
    this.#sub.on("message", (_channel: string, raw: string) => {
      let message: ChannelMessage;
      try {
        message = JSON.parse(raw) as ChannelMessage;
      } catch {
        return;
      }
      for (const l of this.#listeners) l(message);
    });
  }

  /** Resolves once the subscription is in place (tests, start-up). */
  ready() {
    return this.#ready;
  }

  async publish(message: ChannelMessage) {
    await this.#pub.publish(EVENTS, JSON.stringify(message));
  }

  subscribe(listener: (m: ChannelMessage) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async close() {
    this.#listeners.clear();
    await Promise.allSettled([this.#sub.quit(), this.#pub.quit()]);
  }
}

export class ValkeyCounterBuffer implements CounterBuffer {
  readonly kind = "valkey" as const;
  readonly #client: Valkey;

  constructor(url: string, onError: (e: unknown) => void = () => {}) {
    this.#client = connect(url);
    this.#client.on("error", onError);
  }

  async add(field: string, by: number) {
    await this.#client.hincrby(COUNTERS, field, by);
  }

  /**
   * RENAME is atomic: of several replicas flushing at once, exactly one gets each hit. If
   * the process dies between RENAME and the database write, that batch is lost (the
   * documented "at most one interval").
   */
  async take() {
    const tmp = `${COUNTERS}:flush:${randomBytes(6).toString("hex")}`;
    try {
      await this.#client.rename(COUNTERS, tmp);
    } catch (e) {
      if (/no such key/i.test((e as Error).message)) return new Map<string, number>();
      throw e;
    }
    const raw = await this.#client.hgetall(tmp);
    await this.#client.del(tmp);
    return new Map(Object.entries(raw).map(([f, v]) => [f, Number(v)]));
  }

  async giveBack(batch: Map<string, number>) {
    if (!batch.size) return;
    const p = this.#client.pipeline();
    for (const [f, by] of batch) p.hincrby(COUNTERS, f, by);
    await p.exec();
  }

  async peek(fields: string[]) {
    if (!fields.length) return new Map<string, number>();
    const values = await this.#client.hmget(COUNTERS, ...fields);
    return new Map(fields.flatMap((f, i) => (values[i] ? [[f, Number(values[i])] as const] : [])));
  }

  async close() {
    await this.#client.quit().catch(() => {});
  }
}
