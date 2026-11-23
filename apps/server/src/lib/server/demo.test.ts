// SPDX-License-Identifier: AGPL-3.0-or-later
// The demo seed (#163): the base board keeps the IDs the e2e suite opens, and the feature tour
// has something for each visible feature.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authenticate } from "@postmodem/core";
import { reportsStore } from "@postmodem/modules";
import { afterEach, describe, expect, it } from "vitest";
import { type AppContext, createContext } from "./bootstrap.ts";
import { DEMO_PASSWORD, seedDemo } from "./demo.ts";
import { TOUR_FORUMS, TOUR_GALLERY, TOUR_MEMBERS, TOUR_RANK, TOUR_TOPICS } from "./demo-content.ts";
import { demoFiles } from "./demo-setup.ts";
import { uploadsDir } from "./uploads.ts";

describe("demo seed", () => {
  const saved = { ...process.env };
  let ctx: AppContext | undefined;
  afterEach(async () => {
    await ctx?.db.close();
    ctx = undefined;
    process.env = { ...saved };
  });
  async function seeded() {
    process.env.POSTMODEM_DATA_DIR = mkdtempSync(join(tmpdir(), "pm-seed-"));
    process.env.POSTMODEM_LOG_LEVEL = "error";
    ctx = await createContext({ migrate: true });
    const result = await seedDemo(ctx.db.repos, Date.now(), "en", demoFiles(ctx));
    return { c: ctx, repos: ctx.db.repos, result };
  }

  it("keeps the base board's IDs, which the e2e suite opens directly", async () => {
    const { repos } = await seeded();
    expect((await repos.topics.get(1))?.title).toBe("Witamy na forum Postmodem!");
    expect((await repos.topics.get(3))?.title).toBe("Wasze pierwsze komputery");
    const hydepark = (await repos.nodes.tree()).find((n) => n.title === "Hydepark");
    expect(hydepark?.id).toBe(4);
    // 25 topics a page: Hydepark's second page is part of the fixture.
    expect(hydepark?.topicCount).toBe(33);
    expect((await repos.nodes.tree()).find((n) => n.title === "Gry retro")?.id).toBe(5);
    expect((await repos.nodes.tree()).find((n) => n.title === "Komputery")?.id).toBe(6);
  });

  it("adds the feature tour: forums, members with avatars and ranks, a ban, a pending member", async () => {
    const { c, repos, result } = await seeded();
    const titles = (await repos.nodes.tree()).map((n) => n.title);
    for (const f of TOUR_FORUMS) expect(titles).toContain(f.title);
    expect(result.forums).toBe(8 + TOUR_FORUMS.length);

    const kasia = (await repos.users.byUsername("Kasia"))!;
    expect(kasia.avatar).toMatch(/^upload\/[0-9a-f]+\.png$/);
    expect(existsSync(join(uploadsDir(c.config.dataDir), "avatars", kasia.avatar!))).toBe(true);
    expect(kasia.signatureSource).not.toBe("");
    expect((await repos.ranks.get(kasia.rankId!))?.title).toBe(TOUR_RANK);
    expect((await authenticate(repos, "Kasia", DEMO_PASSWORD)).ok).toBe(true);

    const mika = (await repos.users.byUsername("Mika"))!;
    expect(mika.avatar).toBe(`gallery/${TOUR_GALLERY.category}/${TOUR_GALLERY.images[0]}.png`);

    const banned = TOUR_MEMBERS.find((m) => m.banned)!;
    const spammer = (await repos.users.byUsername(banned.username))!;
    expect(
      (await repos.bans.active(Date.now())).some((b) => b.kind === "user" && b.value === String(spammer.id)),
    ).toBe(true);

    const pending = TOUR_MEMBERS.find((m) => m.status === "pending")!;
    expect((await repos.users.byUsername(pending.username))?.status).toBe("pending");
  });

  it("adds a poll, a locked topic, watches, private messages and an open report", async () => {
    const { repos } = await seeded();
    const tree = await repos.nodes.tree();
    const tour = tree.filter((n) => TOUR_FORUMS.some((f) => f.title === n.title));
    const topics = (
      await Promise.all(tour.map((f) => repos.topics.listByNode(f.id, { page: 1, perPage: 50 })))
    ).flatMap((p) => p.items);
    expect(topics.map((t) => t.title).sort()).toEqual(TOUR_TOPICS.map((t) => t.title).sort());
    expect(topics.find((t) => TOUR_TOPICS.find((x) => x.locked)?.title === t.title)?.locked).toBe(true);
    const pollTopic = topics.find((t) => TOUR_TOPICS.find((x) => x.poll)?.title === t.title)!;
    expect(await repos.polls.forTopic(pollTopic.id)).toBeTruthy();

    const kasia = (await repos.users.byUsername("Kasia"))!;
    const intro = topics.find((t) => t.title === "Cześć, jestem Kasia!")!;
    expect(await repos.watches.isWatching(kasia.id, intro.id)).toBe(true);
    const admin = (await repos.users.byUsername("Admin"))!;
    expect((await repos.messages.unreadCount(admin.id)) > 0).toBe(true);
    expect((await repos.messages.inbox(kasia.id, { page: 1, perPage: 10 })).items.length).toBe(1);

    expect((await reportsStore(repos.raw).open()).length).toBe(1);
  });
});
