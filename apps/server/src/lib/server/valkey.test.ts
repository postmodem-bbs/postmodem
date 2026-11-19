// SPDX-License-Identifier: AGPL-3.0-or-later
// Valkey transports, against a real server when PM_TEST_VALKEY_URL is set (CI provides one).
import { type ChannelMessage, Counters, defineCounter, messageId } from "@postmodem/core";
import Valkey from "iovalkey";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ValkeyBus, ValkeyCounterBuffer } from "./valkey.ts";

const url = process.env.PM_TEST_VALKEY_URL;

describe.runIf(url)("Valkey transports", () => {
  const admin = url ? new Valkey(url.replace(/^valkey:/, "redis:")) : null;
  beforeEach(async () => {
    await admin!.flushdb();
  });
  afterAll(async () => {
    await admin?.quit();
  });

  it("the bus reaches every process, the publisher included", async () => {
    const a = new ValkeyBus(url!);
    const b = new ValkeyBus(url!);
    await Promise.all([a.ready(), b.ready()]);
    const got: [string, ChannelMessage][] = [];
    a.subscribe((m) => got.push(["a", m]));
    b.subscribe((m) => got.push(["b", m]));
    const m: ChannelMessage = {
      id: messageId(),
      channel: "core.topic",
      scope: 1,
      event: "post.created",
      data: { postId: 5 },
    };
    await a.publish(m);
    for (let i = 0; i < 50 && got.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    expect(got.map(([who]) => who).sort()).toEqual(["a", "b"]);
    expect(got[0]![1]).toEqual(m);
    await Promise.all([a.close(), b.close()]);
  });

  it("replicas share one counter buffer and each hit is flushed exactly once", async () => {
    const flushed: [string, number][] = [];
    const def = () =>
      defineCounter({
        key: "core.topicViews",
        periods: ["total"],
        flushTotal: async (key, by) => void flushed.push([key, by]),
      });
    const store = { add: async () => {}, read: async () => new Map<string, number>() };
    const [ba, bb] = [new ValkeyCounterBuffer(url!), new ValkeyCounterBuffer(url!)];
    const replicaA = new Counters(ba, store).register(def());
    const replicaB = new Counters(bb, store).register(def());
    replicaA.hit("core.topicViews", 7);
    replicaB.hit("core.topicViews", 7);
    replicaB.hit("core.topicViews", 8, 3);
    await new Promise((r) => setTimeout(r, 50));
    // Seen from either replica before any flush.
    expect(Object.fromEntries(await replicaA.pending("core.topicViews", [7, 8, 9]))).toEqual({
      7: 2,
      8: 3,
      9: 0,
    });
    await Promise.all([replicaA.flush(), replicaB.flush()]);
    expect(flushed.sort()).toEqual([
      ["7", 2],
      ["8", 3],
    ]);
    expect(Object.fromEntries(await replicaB.pending("core.topicViews", [7]))).toEqual({ 7: 0 });

    await ba.giveBack(new Map([["x", 2]]));
    expect(Object.fromEntries(await ba.take())).toEqual({ x: 2 });
    expect((await bb.take()).size).toBe(0);
    await Promise.all([replicaA.close(), replicaB.close()]);
  });
});
