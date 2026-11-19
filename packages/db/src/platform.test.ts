// SPDX-License-Identifier: AGPL-3.0-or-later
// Platform services v0 (M2b slice 10) on every engine: preferences, entity fields,
// collections, counters, and Postgres NOTIFY for the realtime bus.
import {
  CollectionError,
  Collections,
  Counters,
  defineCollection,
  defineCounter,
  defineField,
  definePreference,
  FieldDeniedError,
  Fields,
  MemoryCounterBuffer,
  type Permissions,
  Preferences,
} from "@postmodem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "./database.ts";
import { openTestDatabase, testEngines } from "./testing.ts";

/** Just enough of Permissions: a viewer and a fixed set of allowed capabilities. */
function perms(userId: number | null, allowed: string[] = []): Permissions {
  const can = (c: string) => allowed.includes(c);
  return {
    viewer: { userId, groupIds: [] },
    can,
    decide: () => ({ allowed: false }) as never,
    filter: (c, nodes) => (can(c) ? nodes : []),
    explain: () => "",
  };
}

const colorScheme = definePreference({
  key: "core.colorScheme",
  schema: z.enum(["system", "light", "dark"]),
  default: "system",
  guest: "cookie",
});
const signature = definePreference({
  key: "core.showSignatures",
  schema: z.boolean(),
  default: true,
  guest: "none",
});

describe.each(testEngines())("platform services on %s", (engine) => {
  let db: Database;
  beforeEach(async () => {
    db = await openTestDatabase(engine);
    await db.migrate();
  });
  afterEach(async () => {
    await db.close();
  });

  it("preferences: members' values are stored, guests' go into the cookie, defaults are not kept", async () => {
    const prefs = new Preferences(db.platform.preferences, [colorScheme, signature]);
    await prefs.set(7, "core.colorScheme", "dark");
    await prefs.set(7, "core.showSignatures", false);
    let view = await prefs.forReader(7, undefined);
    expect(view.get(colorScheme)).toBe("dark");
    expect(view.chosen()).toEqual({ "core.colorScheme": "dark", "core.showSignatures": false });
    await prefs.set(7, "core.showSignatures", true); // back to the default
    expect((await db.platform.preferences.load(7))["core.showSignatures"]).toBeUndefined();

    const { cookie } = await prefs.set(null, "core.colorScheme", "light");
    expect(JSON.parse(cookie!)).toEqual({ "core.colorScheme": "light" });
    expect((await prefs.set(null, "core.showSignatures", false)).cookie).toBeNull();
    view = await prefs.forReader(null, cookie!);
    expect(view.get(colorScheme)).toBe("light");
    // A tampered cookie: unknown keys, invalid values and guest-less preferences are ignored.
    view = await prefs.forReader(
      null,
      JSON.stringify({ "core.colorScheme": "pink", "core.showSignatures": false, x: 1 }),
    );
    expect(view.chosen()).toEqual({});
    await expect(prefs.set(7, "core.colorScheme", "pink")).rejects.toThrow(/core.colorScheme/);
    // Signed in: the account's choices win, this device's cookie fills in the rest.
    await prefs.set(8, "core.showSignatures", false);
    view = await prefs.forReader(
      8,
      JSON.stringify({ "core.colorScheme": "dark", "core.showSignatures": true }),
    );
    expect(view.get(colorScheme)).toBe("dark");
    expect(view.get(signature)).toBe(false);
  });

  it("entity fields: one query per target, read and write rules, typed storage", async () => {
    const ip = defineField({
      key: "ip-logging.ip",
      target: "post",
      schema: z.string(),
      read: "staff",
      write: () => false,
      personal: true,
    });
    const mood = defineField({
      key: "moods.mood",
      target: "post",
      schema: z.string().max(20),
      read: "public",
      write: "self",
    });
    const fields = new Fields(db.platform.fields, [ip, mood]);
    await fields.write("ip-logging.ip", 1, "192.0.2.1");
    await fields.write("ip-logging.ip", 2, "192.0.2.2");
    const author = perms(5);
    await fields.set("moods.mood", { perms: author, entityId: 1, node: null, ownerId: 5 }, "happy");
    await expect(
      fields.set("moods.mood", { perms: perms(6), entityId: 1, node: null, ownerId: 5 }, "sad"),
    ).rejects.toBeInstanceOf(FieldDeniedError);
    await expect(
      fields.set("ip-logging.ip", { perms: author, entityId: 1, node: null, ownerId: 5 }, "x"),
    ).rejects.toBeInstanceOf(FieldDeniedError);

    const entities = [1, 2, 3].map((id) => ({ id, node: null, ownerId: 5 }));
    const reader = await fields.load("post", entities, perms(null));
    expect(Object.fromEntries(reader)).toEqual({ 1: { "moods.mood": "happy" } });
    const mod = await fields.load("post", entities, perms(9, ["moderate.edit"]));
    expect(mod.get(1)).toEqual({ "ip-logging.ip": "192.0.2.1", "moods.mood": "happy" });
    expect(mod.get(2)).toEqual({ "ip-logging.ip": "192.0.2.2" });

    await fields.set("moods.mood", { perms: author, entityId: 1, node: null, ownerId: 5 }, undefined);
    await fields.removeEntity("post", 2);
    expect(Object.fromEntries(await fields.load("post", entities, perms(9, ["moderate.edit"])))).toEqual({
      1: { "ip-logging.ip": "192.0.2.1" },
    });
  });

  it("collections: rules, server-set authors, hiding, paging, rate limit and retention", async () => {
    const events: string[] = [];
    const messages = defineCollection({
      key: "shoutbox.messages",
      scope: "board",
      schema: z.object({ body: z.string().min(1).max(200) }).strict(),
      rules: {
        list: (c) => c.perms.can("shoutbox.read", null),
        create: (c) => c.perms.can("shoutbox.post", null),
        update: (c, doc) => doc.author === c.perms.viewer.userId,
        delete: (c, doc) => doc.author === c.perms.viewer.userId || c.perms.can("shoutbox.moderate", null),
        moderate: (c) => c.perms.can("shoutbox.moderate", null),
      },
      createsPerMinute: 3,
      retention: { maxDocs: 4 },
      channel: "shoutbox.live",
    });
    const cols = new Collections(db.platform.docs, (_def, event, doc) => events.push(`${event}:${doc.id}`));
    cols.register(messages);
    let now = 1_700_000_000_000;
    const ctx = (userId: number | null, allowed: string[]) => ({
      perms: perms(userId, allowed),
      scope: 99,
      now,
    });
    const member = (id: number) => ctx(id, ["shoutbox.read", "shoutbox.post"]);
    const mod = ctx(1, ["shoutbox.read", "shoutbox.moderate"]);

    const a = await cols.create("shoutbox.messages", member(2), { body: "first" });
    expect(a).toMatchObject({ author: 2, scope: null, state: "visible", data: { body: "first" } });
    now += 1;
    const b = await cols.create("shoutbox.messages", member(2), { body: "second" });
    now += 1;
    await cols.create("shoutbox.messages", member(2), { body: "third" });
    await expect(cols.create("shoutbox.messages", member(2), { body: "fourth" })).rejects.toMatchObject({
      code: "rate-limited",
    });
    await expect(cols.create("shoutbox.messages", member(3), { body: "" })).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(cols.create("shoutbox.messages", member(3), { body: "x", author: 1 })).rejects.toMatchObject(
      {
        code: "invalid",
      },
    );
    await expect(
      cols.create("shoutbox.messages", ctx(null, ["shoutbox.read"]), { body: "x" }),
    ).rejects.toBeInstanceOf(CollectionError);

    const guest = ctx(null, ["shoutbox.read"]);
    expect((await cols.list("shoutbox.messages", guest)).map((d) => d.data.body)).toEqual([
      "third",
      "second",
      "first",
    ]);
    expect(
      (await cols.list("shoutbox.messages", guest, { limit: 1, before: b.id })).map((d) => d.data.body),
    ).toEqual(["first"]);

    await expect(cols.update("shoutbox.messages", member(3), a.id, { body: "mine" })).rejects.toMatchObject({
      code: "denied",
    });
    await cols.update("shoutbox.messages", member(2), a.id, { body: "edited" });
    await cols.setHidden("shoutbox.messages", mod, b.id, true);
    expect((await cols.list("shoutbox.messages", guest)).map((d) => d.data.body)).toEqual([
      "third",
      "edited",
    ]);
    expect(await cols.list("shoutbox.messages", mod)).toHaveLength(3);
    await expect(cols.update("shoutbox.messages", member(2), b.id, { body: "x" })).rejects.toMatchObject({
      code: "not-found",
    });
    await cols.remove("shoutbox.messages", mod, a.id);
    expect(events).toEqual([
      expect.stringMatching(/^created:/),
      expect.stringMatching(/^created:/),
      expect.stringMatching(/^created:/),
      `updated:${a.id}`,
      `updated:${b.id}`,
      `deleted:${a.id}`,
    ]);

    now += 120_000;
    for (const [i, body] of ["5", "6", "7", "8"].entries()) {
      now += 1;
      await cols.create("shoutbox.messages", member(4 + i), { body });
    }
    expect(await cols.applyRetention(now)).toBe(2);
    expect((await cols.list("shoutbox.messages", mod, { limit: 10 })).map((d) => d.data.body)).toEqual([
      "8",
      "7",
      "6",
      "5",
    ]);
    expect((await db.platform.docs.byAuthor(4)).map((d) => d.data)).toEqual([{ body: "5" }]);
    expect(await db.platform.docs.removeByAuthor(4)).toBe(1);
  });

  it("counters: buffered hits flush once, per period, and failed writes are kept", async () => {
    const flushed: [string, number][] = [];
    let failing = true;
    const views = defineCounter({
      key: "core.topicViews",
      periods: ["total"],
      async flushTotal(key, by) {
        if (failing) throw new Error("db down");
        flushed.push([key, by]);
      },
    });
    const clicks = defineCounter({ key: "ads.clicks", periods: ["total", "day"] });
    const now = Date.UTC(2026, 10, 19, 12);
    const counters = new Counters(new MemoryCounterBuffer(), db.platform.counters, { now: () => now });
    counters.register(views, clicks);
    counters.hit("core.topicViews", 10);
    counters.hit("core.topicViews", 10);
    counters.hit("ads.clicks", "ad-1", 3);
    counters.hit("nope.unknown", 1); // never throws
    expect(Object.fromEntries(await counters.pending("core.topicViews", [10, 11]))).toEqual({ 10: 2, 11: 0 });

    await counters.flush();
    expect(flushed).toEqual([]);
    expect(Object.fromEntries(await counters.pending("core.topicViews", [10]))).toEqual({ 10: 2 });
    failing = false;
    counters.hit("ads.clicks", "ad-1");
    await counters.flush();
    expect(flushed).toEqual([["10", 2]]);
    expect(Object.fromEntries(await counters.read("ads.clicks", ["ad-1", "ad-2"]))).toEqual({
      "ad-1": 4,
      "ad-2": 0,
    });
    expect((await counters.read("ads.clicks", ["ad-1"], "day")).get("ad-1")).toBe(4);
    expect((await counters.read("ads.clicks", ["ad-1"], "day", now + 86_400_000)).get("ad-1")).toBe(0);
  });

  it.runIf(engine !== "sqlite")("Postgres NOTIFY reaches a listener", async () => {
    const got: string[] = [];
    const stop = await db.pubsub!.listen("pm_test", (p) => got.push(p));
    await db.pubsub!.notify("pm_test", '{"x":1}');
    for (let i = 0; i < 50 && !got.length; i++) await new Promise((r) => setTimeout(r, 20));
    await stop();
    expect(got).toEqual(['{"x":1}']);
  });

  it.runIf(engine === "sqlite")("SQLite has no pub/sub (solo mode keeps the bus in memory)", () => {
    expect(db.pubsub).toBeNull();
  });
});
