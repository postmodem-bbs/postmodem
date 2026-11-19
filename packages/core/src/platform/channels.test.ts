// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Permissions } from "../domain/core-permissions.ts";
import {
  type ChannelMessage,
  Channels,
  defineChannel,
  MAX_SUBSCRIPTIONS,
  MemoryBus,
  REPLAY_MS,
} from "./channels.ts";

const perms = (userId: number | null): Permissions =>
  ({ viewer: { userId, groupIds: [] }, can: () => userId !== null }) as unknown as Permissions;

const topic = defineChannel({ key: "core.topic", scope: "topic", subscribe: (_p, scope) => scope !== 13 });
const queue = defineChannel({ key: "reports.queue", scope: "board", subscribe: (p) => p.can("x", null) });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("channels", () => {
  it("only authorized subscriptions survive, deduplicated and capped", async () => {
    const ch = new Channels(new MemoryBus()).register(topic, queue);
    expect(
      await ch.authorize(perms(null), [
        { channel: "core.topic", scope: 1 },
        { channel: "core.topic", scope: 1 },
        { channel: "core.topic", scope: 13 },
        { channel: "core.topic", scope: null },
        { channel: "reports.queue", scope: 5 },
        { channel: "nope.nope", scope: null },
      ]),
    ).toEqual([{ channel: "core.topic", scope: 1 }]);
    expect(await ch.authorize(perms(1), [{ channel: "reports.queue", scope: 5 }])).toEqual([
      { channel: "reports.queue", scope: null },
    ]);
    const many = Array.from({ length: 20 }, (_, i) => ({ channel: "core.topic", scope: i + 100 }));
    expect(await ch.authorize(perms(1), many)).toHaveLength(MAX_SUBSCRIPTIONS);
  });

  it("delivers by channel and scope, replays what a reconnecting stream missed", async () => {
    let now = 1_000_000;
    const ch = new Channels(new MemoryBus(), () => now).register(topic, queue);
    const got: ChannelMessage[] = [];
    const close = ch.open([{ channel: "core.topic", scope: 1 }], (m) => got.push(m));
    await ch.publish("core.topic", 1, "post", { postId: 10 });
    await ch.publish("core.topic", 2, "post", { postId: 11 });
    await ch.publish("reports.queue", null, "changed");
    await tick();
    expect(got.map((m) => m.data.postId)).toEqual([10]);
    expect(ch.streamCount()).toBe(1);
    close();
    expect(ch.streamCount()).toBe(0);

    await ch.publish("core.topic", 1, "post", { postId: 12 });
    await ch.publish("core.topic", 1, "post", { postId: 13 });
    await tick();
    const again: ChannelMessage[] = [];
    ch.open([{ channel: "core.topic", scope: 1 }], (m) => again.push(m), got[0]!.id);
    expect(again.map((m) => m.data.postId)).toEqual([12, 13]);

    now += REPLAY_MS + 1;
    await ch.publish("core.topic", 1, "post", { postId: 14 });
    await tick();
    const late: ChannelMessage[] = [];
    ch.open([{ channel: "core.topic", scope: 1 }], (m) => late.push(m), got[0]!.id);
    expect(late.map((m) => m.data.postId)).toEqual([14]);
  });

  it("refuses unknown channels and oversized payloads", async () => {
    const ch = new Channels(new MemoryBus()).register(topic);
    await expect(ch.publish("nope.nope", null, "x")).rejects.toThrow(/unknown channel/);
    await expect(ch.publish("core.topic", 1, "x", { big: "x".repeat(5000) })).rejects.toThrow(/bytes/);
    expect(() => defineChannel({ key: "Bad", scope: "board", subscribe: () => true })).toThrow();
  });
});
