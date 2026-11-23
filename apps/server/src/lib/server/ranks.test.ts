// SPDX-License-Identifier: AGPL-3.0-or-later
// The ranks a new board starts with (#130).
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SUPPORTED } from "@postmodem/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { rankImageUrl, rankTitle } from "./board.ts";
import { type AppContext, createContext } from "./bootstrap.ts";
import { DEFAULT_RANKS, seedDefaultRanks } from "./ranks.ts";

const STATIC = join(import.meta.dirname, "../../../static");

describe("default ranks", () => {
  const saved = { ...process.env };
  let ctx: AppContext | undefined;
  afterEach(async () => {
    await ctx?.db.close();
    ctx = undefined;
    process.env = { ...saved };
  });
  async function board() {
    process.env.POSTMODEM_DATA_DIR = mkdtempSync(join(tmpdir(), "pm-ranks-"));
    process.env.POSTMODEM_LOG_LEVEL = "error";
    ctx = await createContext({ migrate: true });
    return ctx.db.repos;
  }

  it("ship a badge for every rank in every language, with no script in it", () => {
    for (const locale of SUPPORTED)
      for (const key of DEFAULT_RANKS) {
        const file = join(STATIC, "ranks/default", locale, `rank_${key}.svg`);
        expect(existsSync(file), file).toBe(true);
        const svg = readFileSync(file, "utf8");
        expect(svg).toContain("SPDX-License-Identifier: AGPL-3.0-or-later");
        expect(svg).not.toMatch(/<script|\son\w+=|href=|<foreignObject/i);
      }
  });

  it("are seeded in the board's language, once, and only on a board without ranks", async () => {
    const repos = await board();
    const ranks = await seedDefaultRanks(repos, "pl");
    expect([...(ranks?.keys() ?? [])]).toEqual([...DEFAULT_RANKS]);
    const all = await repos.ranks.all();
    expect(all.map((r) => [r.title, r.special, r.minPosts])).toEqual([
      ["Właściciel", true, null],
      ["Admin", true, null],
      ["Mod", true, null],
      ["VIP", true, null],
      ["Użytkownik", false, 0],
    ]);
    // Titles and badges follow each reader's language; the stored title is the board's.
    const mod = ranks!.get("mod")!;
    expect(rankImageUrl(mod.image, "pl")).toBe("/ranks/default/pl/rank_mod.svg");
    expect(rankImageUrl(mod.image, "en")).toBe("/ranks/default/en/rank_mod.svg");
    const owner = ranks!.get("owner")!;
    expect(rankTitle(owner, "en")).toBe("Owner");
    expect(rankTitle(owner, "pl")).toBe("Właściciel");
    // Renamed (no key) or an unknown key: the title as typed, for everyone.
    expect(rankTitle({ ...owner, titleKey: null, title: "Szef" }, "en")).toBe("Szef");
    expect(rankTitle({ ...owner, titleKey: "rank-default-nope" }, "en")).toBe("Właściciel");
    expect(await seedDefaultRanks(repos, "en")).toBeNull();
    expect(await repos.ranks.all()).toHaveLength(5);
  });
});
