// SPDX-License-Identifier: AGPL-3.0-or-later
// Reply e-mail per member (M2b slice 12): right away, in a daily digest, or not at all.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTopic, type Repositories, reply, type User } from "@postmodem/core";
import { afterEach, describe, expect, it } from "vitest";
import { type AppContext, createContext } from "./bootstrap.ts";
import { urlsFor } from "./links.ts";
import { afterPost, nextDigestAt, sendDigests, topicVisited } from "./notifications.ts";

const at = (iso: string) => Date.parse(iso);

describe("nextDigestAt", () => {
  it("is the next time the hour comes round in UTC", () => {
    expect(nextDigestAt(at("2026-11-20T06:00:00Z"), 7, null)).toBe(at("2026-11-20T07:00:00Z"));
    expect(nextDigestAt(at("2026-11-20T07:00:00Z"), 7, null)).toBe(at("2026-11-21T07:00:00Z"));
    expect(nextDigestAt(at("2026-11-20T10:00:00Z"), 7, "UTC")).toBe(at("2026-11-21T07:00:00Z"));
  });
  it("follows the member's time zone", () => {
    // Warsaw is UTC+1 in November and UTC+2 in July.
    expect(nextDigestAt(at("2026-11-20T10:00:00Z"), 7, "Europe/Warsaw")).toBe(at("2026-11-21T06:00:00Z"));
    expect(nextDigestAt(at("2026-07-01T04:00:00Z"), 7, "Europe/Warsaw")).toBe(at("2026-07-01T05:00:00Z"));
    expect(nextDigestAt(at("2026-11-20T10:00:00Z"), 7, "America/New_York")).toBe(at("2026-11-20T12:00:00Z"));
  });
  it("goes out an hour late when daylight saving skips the hour", () => {
    // 2026-03-29 02:00 doesn't exist in Warsaw: clocks go from 02:00 CET to 03:00 CEST.
    expect(nextDigestAt(at("2026-03-28T23:00:00Z"), 2, "Europe/Warsaw")).toBe(at("2026-03-29T01:00:00Z"));
  });
  it("falls back to UTC for an unknown zone", () => {
    expect(nextDigestAt(at("2026-11-20T06:00:00Z"), 7, "Mars/Olympus_Mons")).toBe(at("2026-11-20T07:00:00Z"));
  });
});

describe("reply e-mail", () => {
  const saved = { ...process.env };
  let ctx: AppContext | undefined;
  afterEach(async () => {
    await ctx?.db.close();
    ctx = undefined;
    process.env = { ...saved };
  });

  async function board() {
    process.env.POSTMODEM_DATA_DIR = mkdtempSync(join(tmpdir(), "pm-notify-"));
    process.env.POSTMODEM_LOG_LEVEL = "error";
    ctx = await createContext({ migrate: true });
    const repos: Repositories = ctx.db.repos;
    const forum = await repos.nodes.create({ parentId: null, kind: "forum", title: "Forum" });
    const member = (username: string, timezone: string | null = null) =>
      repos.users.create({ username, email: `${username}@example.org`, timezone });
    const alice = await member("alice");
    const bob = await member("bob", "Europe/Warsaw");
    const carol = await member("carol");
    const c = ctx;
    const started = await createTopic(
      repos,
      await c.permissions(alice.id),
      alice,
      { nodeId: forum.id, title: "Amiga 500", source: "Start" },
      { floodSeconds: 0, maxLength: 1000 },
    );
    if (!started.ok) throw new Error(started.problem);
    const topic = started.topic;
    await repos.watches.watch(bob.id, topic.id);
    await repos.watches.watch(carol.id, topic.id);
    const post = async (author: User, source: string) => {
      const r = await reply(
        repos,
        await c.permissions(author.id),
        author,
        { topicId: topic.id, source },
        { floodSeconds: 0, maxLength: 1000 },
      );
      if (!r.ok) throw new Error(r.problem);
      await afterPost(c, urlsFor("numbered"), r.topic, r.post, author);
      return r.post;
    };
    /** Every e-mail queued since the last call, as recipient and text. */
    const mail = async () => {
      const out: { to: string; subject: string; text: string }[] = [];
      for (;;) {
        const job = await repos.jobs.claim(["mail.send"], "test", Date.now() + 1, 60_000);
        if (!job) return out;
        out.push(job.payload as { to: string; subject: string; text: string });
        await repos.jobs.complete(job.id, Date.now());
      }
    };
    return { ctx: c, topic, alice, bob, carol, post, mail };
  }

  it("sends right away by default, and collects a daily digest for members who chose it", async () => {
    const { ctx, topic, alice, bob, post, mail } = await board();
    await ctx.platform.preferences.set(bob.id, "core.replyMail", "daily");
    const first = await post(alice, "First reply");
    await post(alice, "Second reply");
    expect((await mail()).map((m) => m.to)).toEqual(["carol@example.org"]);

    // Bob's digest goes out at 07:00 in Warsaw, not before.
    expect(await sendDigests(ctx, Date.now())).toBe(0);
    expect(await sendDigests(ctx, Date.now() + 25 * 3600_000)).toBe(1);
    const [digest] = await mail();
    expect(digest).toMatchObject({ to: "bob@example.org" });
    expect(digest!.subject).toContain("New replies in a topic you watch");
    expect(digest!.text).toContain('"Amiga 500": 2 new replies');
    // The link opens the first reply Bob hasn't seen (the board's own link style: classic).
    expect(digest!.text).toContain(`viewtopic.php?p=${first.id}#p${first.id}`);
    expect(await sendDigests(ctx, Date.now() + 25 * 3600_000)).toBe(0);
    // Until Bob visits, further replies don't add the topic again.
    await post(alice, "Third reply");
    expect(await sendDigests(ctx, Date.now() + 49 * 3600_000)).toBe(0);
    await topicVisited(ctx, bob, topic);
    await post(alice, "Fourth reply");
    expect(await sendDigests(ctx, Date.now() + 49 * 3600_000)).toBe(1);
  });

  it("drops a topic from the digest once the member reads it, and sends nothing when off", async () => {
    const { ctx, topic, alice, bob, carol, post, mail } = await board();
    await ctx.platform.preferences.set(bob.id, "core.replyMail", "daily");
    await ctx.platform.preferences.set(carol.id, "core.replyMail", "off");
    await post(alice, "A reply");
    await topicVisited(ctx, bob, topic);
    expect(await sendDigests(ctx, Date.now() + 25 * 3600_000)).toBe(0);
    expect(await mail()).toEqual([]);
  });
});
