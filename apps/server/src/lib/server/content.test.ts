// SPDX-License-Identifier: AGPL-3.0-or-later
import { openTestDatabase } from "@postmodem/db/testing";
import { RENDER_VERSION } from "@postmodem/markup";
import { describe, expect, it } from "vitest";
import { createRenderer } from "./content.ts";

describe("post renderer", () => {
  it("renders stale posts once, caches them, and fills holes per reader", async () => {
    const db = await openTestDatabase("sqlite");
    await db.migrate();
    const r = db.repos;
    await r.smilies.create({ code: ":-)", image: "icon_smile.gif", emotion: "Smile", position: 1 });
    const forum = await r.nodes.create({ parentId: null, kind: "forum", title: "F" });
    const topic = await r.topics.create({ nodeId: forum.id, title: "T", authorId: null });
    const post = await r.posts.create({
      topicId: topic.id,
      authorId: null,
      source: "[b]Cześć[/b] [you] :-) [hide]tajne[/hide]",
      format: "bbcode-phpbb2",
    });

    const renderer = createRenderer(r);
    const html = (await renderer.render([post])).get(post.id)!;
    expect(html).toContain("<strong>Cześć</strong>");
    expect(html).toContain('class="smiley"');
    expect(html).not.toContain("tajne");

    const cached = (await r.posts.get(post.id))!;
    expect(cached).toMatchObject({ rendered: html, renderVersion: RENDER_VERSION });
    // A cached post is returned as stored, without touching smilies or the database.
    await r.smilies.create({ code: ":lol:", image: "icon_lol.gif", emotion: "Laughing", position: 2 });
    expect((await renderer.render([cached])).get(post.id)).toBe(html);

    const messages = { guest: "gość", hiddenContent: "Ta treść jest ukryta." };
    expect(renderer.forReader(html, "Ala", messages)).toContain('<span class="bb-you">Ala</span>');
    expect(renderer.forReader(html, null, messages)).toContain(
      '<p class="bb-hidden">Ta treść jest ukryta.</p>',
    );
    await db.close();
  });
  it("resolves nested hide fragments only for permitted topic readers", async () => {
    const db = await openTestDatabase("sqlite");
    try {
      await db.migrate();
      const r = db.repos;
      const forum = await r.nodes.create({ parentId: null, kind: "forum", title: "F" });
      const topic = await r.topics.create({ nodeId: forum.id, title: "T", authorId: null });
      const create = (source: string) =>
        r.posts.create({ topicId: topic.id, authorId: null, format: "bbcode-phpbb2", source });
      const first = await create("outside [hide]secret [hide][b]nested[/b][/hide] tail[/hide]");
      const second = await create("[hide]another secret[/hide]");
      const key = "hide-until-reply:hidden";
      const renderer = createRenderer(r, new Map([["hide", key]]));
      let resolutions = 0;
      const unlocked = await renderer.render([first, second], async (keys) => {
        resolutions++;
        expect([...keys]).toEqual([key]);
        return keys;
      });
      expect(resolutions).toBe(1);
      expect(unlocked.get(first.id)).toContain("secret <strong>nested</strong> tail");
      expect(unlocked.get(second.id)).toContain("another secret");

      const cached = (await r.posts.get(first.id))!;
      expect(cached.renderVersion).toBe(RENDER_VERSION);
      const locked = (await renderer.render([cached])).get(first.id)!;
      expect(locked).toBe("outside <!--pm-hole:hide-->");
      expect((await createRenderer(r).render([cached])).get(first.id)).toBe(locked);
      expect(await renderer.preview(first.source)).toBe(locked);
    } finally {
      await db.close();
    }
  });
});
