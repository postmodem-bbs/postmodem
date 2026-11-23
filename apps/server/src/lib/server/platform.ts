// SPDX-License-Identifier: AGPL-3.0-or-later
// The platform services for this process (M2b slice 10, PLATFORM-SERVICES.md): the core's
// own declarations plus every installed package's, on the transports the configuration
// names. Solo: everything in the database and in memory. Stack: the bus over Postgres
// LISTEN/NOTIFY. With Valkey (`scale`): the bus and the counter buffer on Valkey.
import {
  type Bus,
  type ChannelMessage,
  Channels,
  Collections,
  type Config,
  Counters,
  DATE_FORMATS,
  defineChannel,
  defineCounter,
  definePreference,
  Fields,
  type Logger,
  MemoryBus,
  MemoryCounterBuffer,
  type PackageDefinition,
  Preferences,
  THEME_IDS,
} from "@postmodem/core";
import type { Database } from "@postmodem/db";
import { SUPPORTED } from "@postmodem/i18n/locales";
import { z } from "zod";
import { ValkeyBus, ValkeyCounterBuffer } from "./valkey.ts";

export const readerTheme = definePreference({
  key: "core.theme",
  schema: z.enum(["board", ...THEME_IDS]),
  default: "board" as const,
  guest: "cookie",
  inheritGuest: false,
});

/** The reader's colour scheme (the footer's light/dark switch). */
export const colorScheme = definePreference({
  key: "core.colorScheme",
  schema: z.enum(["system", "light", "dark"]),
  default: "system" as const,
  guest: "cookie",
});
/** "auto" follows the browser (Accept-Language), then the board's default. */
export const language = definePreference({
  key: "core.language",
  schema: z.enum(["auto", ...SUPPORTED]),
  default: "auto" as const,
  guest: "cookie",
});

/** How dates are written; "board" follows the board's setting. Members only (guests get the board's). */
export const dateFormat = definePreference({
  key: "core.dateFormat",
  schema: z.enum(["board", ...DATE_FORMATS]),
  default: "board" as const,
  guest: "none",
});

/**
 * E-mail about replies in watched topics: right away (phpBB2's one e-mail until the next
 * visit), in a daily digest, or not at all (M2b slice 12). Members only.
 */
export const replyMail = definePreference({
  key: "core.replyMail",
  schema: z.enum(["instant", "daily", "off"]),
  default: "instant" as const,
  guest: "none",
  section: "notifications",
});

/** New posts in a topic, for readers who may read its forum. */
export const topicChannel = defineChannel({
  key: "core.topic",
  scope: "topic",
  async subscribe(perms, scope, repos) {
    const topic = scope === null ? undefined : await repos.topics.get(scope);
    const node = topic && (await repos.nodes.get(topic.nodeId));
    return !!node && topic.visibility === "core:public" && perms.can("node.read", node);
  },
});
/** A member's own updates (private messages, notifications); only they may follow it. */
export const userChannel = defineChannel({
  key: "core.user",
  scope: "user",
  subscribe: (perms, scope) => perms.viewer.userId !== null && perms.viewer.userId === scope,
});

export const TOPIC_VIEWS = "core.topicViews";

/** The bus between web processes over Postgres LISTEN/NOTIFY (stack mode's default). */
class PostgresBus implements Bus {
  readonly kind = "postgres" as const;
  readonly #listeners = new Set<(m: ChannelMessage) => void>();
  readonly #stop: Promise<() => Promise<void>>;
  readonly #pubsub: NonNullable<Database["pubsub"]>;

  constructor(pubsub: NonNullable<Database["pubsub"]>, onError: (e: unknown) => void) {
    this.#pubsub = pubsub;
    this.#stop = pubsub.listen("pm_events", (raw) => {
      let m: ChannelMessage;
      try {
        m = JSON.parse(raw) as ChannelMessage;
      } catch {
        return;
      }
      for (const l of this.#listeners) l(m);
    });
    this.#stop.catch(onError);
  }
  ready() {
    return this.#stop;
  }
  async publish(m: ChannelMessage) {
    await this.#pubsub.notify("pm_events", JSON.stringify(m));
  }
  subscribe(l: (m: ChannelMessage) => void) {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  }
  async close() {
    this.#listeners.clear();
    await (await this.#stop.catch(() => async () => {}))();
  }
}

export interface Platform {
  preferences: Preferences;
  fields: Fields;
  collections: Collections;
  channels: Channels;
  counters: Counters;
  /** Open live streams' closers (so shutdown can end them at once instead of waiting). */
  streams: Set<() => void>;
  endStreams(): void;
  close(): Promise<void>;
}

export function createPlatform(opts: {
  config: Pick<Config, "countersUrl" | "realtimeUrl">;
  db: Database;
  installed: PackageDefinition[];
  log: Logger;
}): Platform {
  const { db, installed, log } = opts;
  // A transport that is down fails on every retry; say so once a minute, not hundreds of times.
  const lastWarned = new Map<string, { at: number; skipped: number }>();
  const warn = (what: string) => (e: unknown) => {
    const now = Date.now();
    const seen = lastWarned.get(what);
    if (seen && now - seen.at < 60_000) {
      seen.skipped++;
      return;
    }
    lastWarned.set(what, { at: now, skipped: 0 });
    log.warn(what, { error: (e as Error).message, ...(seen?.skipped ? { repeated: seen.skipped } : {}) });
  };

  const realtime = opts.config.realtimeUrl ?? (db.pubsub ? "postgres://" : "memory://");
  if (realtime.startsWith("postgres:") && !db.pubsub)
    log.warn(
      "POSTMODEM_REALTIME_URL=postgres:// needs a Postgres database; live updates stay in this process",
    );
  const bus: Bus = /^(valkey|redis)s?:/.test(realtime)
    ? new ValkeyBus(realtime, warn("live updates: Valkey error"))
    : realtime.startsWith("postgres:") && db.pubsub
      ? new PostgresBus(db.pubsub, warn("live updates: could not listen on Postgres"))
      : new MemoryBus();
  const channels = new Channels(bus, db.repos).register(topicChannel, userChannel);

  const counters = new Counters(
    opts.config.countersUrl && !opts.config.countersUrl.startsWith("memory:")
      ? new ValkeyCounterBuffer(opts.config.countersUrl, warn("counters: Valkey error"))
      : new MemoryCounterBuffer(),
    db.platform.counters,
    { onError: warn("could not save counters") },
  ).register(
    defineCounter({
      key: TOPIC_VIEWS,
      periods: ["total"],
      flushTotal: (key, by) => db.repos.topics.addViews(Number(key), by),
    }),
  );

  const preferences = new Preferences(db.platform.preferences, [
    readerTheme,
    colorScheme,
    language,
    dateFormat,
    replyMail,
  ]);
  const fields = new Fields(db.platform.fields);
  const collections = new Collections(db.platform.docs, (def, event, doc) => {
    if (def.channel)
      channels
        .publish(def.channel, doc.scope, `doc.${event}`, { id: doc.id })
        .catch(warn("could not announce"));
  });

  for (const p of installed) {
    preferences.register(...(p.preferences ?? []));
    fields.register(...(p.fields ?? []));
    collections.register(...(p.collections ?? []));
    channels.register(...(p.channels ?? []));
    counters.register(...(p.counters ?? []));
  }
  log.info("platform services", { realtime: channels.transport, counters: counters.transport });

  const streams = new Set<() => void>();
  const endStreams = () => {
    for (const end of streams) end();
    streams.clear();
  };
  return {
    preferences,
    fields,
    collections,
    channels,
    counters,
    streams,
    endStreams,
    async close() {
      endStreams();
      await counters.close();
      await channels.close();
    },
  };
}
