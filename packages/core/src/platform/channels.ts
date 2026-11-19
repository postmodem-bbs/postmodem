// SPDX-License-Identifier: AGPL-3.0-or-later
// Channels (PLATFORM-SERVICES §7, M2b slice 10): live updates for readers' open pages. The
// server publishes (core events, collection writes, packages' own code), never the browser.
// A bus carries messages between processes (in-process for solo, Postgres LISTEN/NOTIFY or
// Valkey pub/sub for stack); every web process keeps a short replay buffer so a stream that
// reconnects (Last-Event-ID) misses nothing, whichever replica it lands on.
import type { Permissions } from "../domain/core-permissions.ts";
import type { Id, Millis } from "../domain/types.ts";

export interface ChannelDef {
  /** `<package>.<name>`, e.g. `core.topic` or `reports.queue`. */
  key: string;
  /** What a subscription names: nothing (board-wide), or a topic, forum or user id. */
  scope: "board" | "node" | "topic" | "user";
  /** May this reader follow the channel (at this scope)? Checked when the stream opens. */
  subscribe(perms: Permissions, scope: Id | null): boolean | Promise<boolean>;
}

const KEY = /^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9]*$/;

export function defineChannel(def: ChannelDef): ChannelDef {
  if (!KEY.test(def.key)) throw new Error(`invalid channel key '${def.key}': expected <package>.<name>`);
  return def;
}

/**
 * One message. Payloads carry ids and counts, not content: the page fetches what it shows
 * through the normal, permission-checked routes. That also keeps NOTIFY under its 8 KB.
 */
export interface ChannelMessage {
  /** `<publish time>-<sequence>`, ordered; the SSE event id. */
  id: string;
  channel: string;
  scope: Id | null;
  event: string;
  data: Record<string, unknown>;
}

export const PAYLOAD_MAX_BYTES = 4096;

/** Transport between processes. Every process, the publisher included, hears every message. */
export interface Bus {
  readonly kind: "memory" | "postgres" | "valkey";
  publish(message: ChannelMessage): Promise<void>;
  subscribe(listener: (message: ChannelMessage) => void): () => void;
  close(): Promise<void>;
}

export class MemoryBus implements Bus {
  readonly kind = "memory" as const;
  readonly #listeners = new Set<(m: ChannelMessage) => void>();
  async publish(message: ChannelMessage) {
    // Async like the real transports, so publishers never run listeners inline.
    queueMicrotask(() => {
      for (const l of this.#listeners) l(message);
    });
  }
  subscribe(listener: (m: ChannelMessage) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  async close() {
    this.#listeners.clear();
  }
}

let sequence = 0;
/** Ids sort by time first, then by a per-process counter, padded so text order is time order. */
export function messageId(now: Millis = Date.now()): string {
  sequence = (sequence + 1) % 1_000_000;
  return `${now.toString().padStart(14, "0")}-${sequence.toString().padStart(6, "0")}`;
}

export interface Subscription {
  channel: string;
  scope: Id | null;
}
const subKey = (s: Subscription) => `${s.channel}:${s.scope ?? ""}`;

/** How long a reconnecting stream can be gone and still get what it missed. */
export const REPLAY_MS = 120_000;
/** Messages kept for replay at most, whatever their age. */
export const REPLAY_MAX = 10_000;
/** Subscriptions one open page may hold. */
export const MAX_SUBSCRIPTIONS = 10;

export class ChannelError extends Error {}

/**
 * The per-process hub: knows the declared channels, publishes through the bus, and hands
 * each message to the open streams that follow its channel and scope.
 */
export class Channels {
  readonly #defs = new Map<string, ChannelDef>();
  readonly #streams = new Map<string, Set<(m: ChannelMessage) => void>>();
  readonly #replay: ChannelMessage[] = [];
  readonly #bus: Bus;
  readonly #unsubscribe: () => void;
  readonly #now: () => Millis;

  constructor(bus: Bus, now: () => Millis = Date.now) {
    this.#bus = bus;
    this.#now = now;
    this.#unsubscribe = bus.subscribe((m) => this.#deliver(m));
  }

  get transport() {
    return this.#bus.kind;
  }

  register(...defs: ChannelDef[]): this {
    for (const d of defs) {
      if (this.#defs.has(d.key)) throw new Error(`channel '${d.key}' is already registered`);
      this.#defs.set(d.key, d);
    }
    return this;
  }

  definition(key: string) {
    return this.#defs.get(key);
  }

  async publish(channel: string, scope: Id | null, event: string, data: Record<string, unknown> = {}) {
    if (!this.#defs.has(channel)) throw new ChannelError(`unknown channel '${channel}'`);
    const message: ChannelMessage = { id: messageId(this.#now()), channel, scope, event, data };
    if (Buffer.byteLength(JSON.stringify(message)) > PAYLOAD_MAX_BYTES)
      throw new ChannelError(`message on '${channel}' is over ${PAYLOAD_MAX_BYTES} bytes`);
    await this.#bus.publish(message);
  }

  /**
   * Checks each requested subscription against its channel's rule; returns the allowed ones
   * (silently dropping the rest, so a page never learns more than it may).
   */
  async authorize(perms: Permissions, requested: Subscription[]): Promise<Subscription[]> {
    const out: Subscription[] = [];
    const seen = new Set<string>();
    for (const s of requested.slice(0, MAX_SUBSCRIPTIONS)) {
      const def = this.#defs.get(s.channel);
      if (!def || seen.has(subKey(s))) continue;
      const scope = def.scope === "board" ? null : s.scope;
      if (def.scope !== "board" && scope === null) continue;
      if (await def.subscribe(perms, scope)) {
        out.push({ channel: s.channel, scope });
        seen.add(subKey(s));
      }
    }
    return out;
  }

  /** Follows these (already authorized) subscriptions; replays what came after `lastId`. */
  open(subs: Subscription[], send: (m: ChannelMessage) => void, lastId?: string): () => void {
    const keys = subs.map(subKey);
    if (lastId) {
      const wanted = new Set(keys);
      for (const m of this.#replay) if (m.id > lastId && wanted.has(subKey(m))) send(m);
    }
    for (const k of keys) {
      let set = this.#streams.get(k);
      if (!set) {
        set = new Set();
        this.#streams.set(k, set);
      }
      set.add(send);
    }
    return () => {
      for (const k of keys) {
        const set = this.#streams.get(k);
        set?.delete(send);
        if (set && !set.size) this.#streams.delete(k);
      }
    };
  }

  /** Open streams in this process (for /readyz-style reporting and tests). */
  streamCount(): number {
    const all = new Set<unknown>();
    for (const set of this.#streams.values()) for (const s of set) all.add(s);
    return all.size;
  }

  #deliver(m: ChannelMessage) {
    const cutoff = this.#now() - REPLAY_MS;
    this.#replay.push(m);
    while (
      this.#replay.length &&
      (this.#replay.length > REPLAY_MAX || Number(this.#replay[0]!.id.split("-")[0]) < cutoff)
    )
      this.#replay.shift();
    for (const send of this.#streams.get(subKey(m)) ?? []) {
      try {
        send(m);
      } catch {
        // A stream that can't take a message is closing; its own cleanup removes it.
      }
    }
  }

  async close() {
    this.#unsubscribe();
    this.#streams.clear();
    await this.#bus.close();
  }
}
