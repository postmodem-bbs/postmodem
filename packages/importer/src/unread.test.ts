// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, it } from "vitest";
import { PRZEMO_COLUMNS, PRZEMO_TABLES, SCHEMA_COLUMNS } from "./przemo-additions.ts";
import { classifyUnread } from "./unread.ts";

it("matches the uninstaller's counts (PACKAGES.md §0)", () => {
  expect(PRZEMO_TABLES).toHaveLength(24);
  expect(Object.values(PRZEMO_COLUMNS).flat()).toHaveLength(107);
  // Every Przemo table and every column it adds exists in Przemo's own schema.
  for (const t of PRZEMO_TABLES) expect(SCHEMA_COLUMNS[t], t).toBeDefined();
  for (const [t, cols] of Object.entries(PRZEMO_COLUMNS))
    for (const c of cols) expect(SCHEMA_COLUMNS[t], `${t}.${c}`).toContain(c);
});

it("tells Przemo additions, stock leftovers and other mods' data apart", () => {
  const sorted = classifyUnread(
    {
      tables: ["phpbb_shoutbox", "phpbb_search_wordlist", "phpbb_arcade_games", "other_table"],
      columns: {
        phpbb_users: ["user_gender", "user_session_time", "user_arcade_score"],
        phpbb_shoutbox: ["msg"],
      },
      config: ["cload", "board_email", "arcade_on"],
    },
    "phpbb_",
  );
  expect(sorted.przemo).toEqual({
    tables: ["phpbb_shoutbox"],
    columns: { phpbb_users: ["user_gender"], phpbb_shoutbox: ["msg"] },
    config: ["cload"],
  });
  expect(sorted.stock).toEqual({
    tables: ["phpbb_search_wordlist"],
    columns: { phpbb_users: ["user_session_time"] },
  });
  expect(sorted.unknown).toEqual({
    tables: ["phpbb_arcade_games", "other_table"],
    columns: { phpbb_users: ["user_arcade_score"] },
  });
});
