// SPDX-License-Identifier: AGPL-3.0-or-later
// Sorts what the core didn't import by origin:
//   przemo   its uninstaller lists it, so a package imports it with that package (M3);
//   stock    part of a stock Przemo board (vanilla phpBB2, or a column Przemo keeps), but
//            nothing needs it (search index, sessions, themes…);
//   unknown  in neither: another mod's tables and columns, which no package will import.
// The last bucket is what an admin should look at before switching boards.
import { PRZEMO_COLUMNS, PRZEMO_CONFIG, PRZEMO_TABLES, SCHEMA_COLUMNS } from "./przemo-additions.ts";

export interface Unread {
  /** With the table prefix, as in the report. */
  tables: string[];
  columns: Record<string, string[]>;
  config: string[];
}

export interface UnreadByOrigin {
  przemo: Unread;
  stock: { tables: string[]; columns: Record<string, string[]> };
  /** Config keys of other mods can't be told from vanilla ones, so there are none here. */
  unknown: { tables: string[]; columns: Record<string, string[]> };
}

export function classifyUnread(unread: Unread, prefix: string): UnreadByOrigin {
  const out: UnreadByOrigin = {
    przemo: { tables: [], columns: {}, config: [] },
    stock: { tables: [], columns: {} },
    unknown: { tables: [], columns: {} },
  };
  const bare = (t: string) => (t.startsWith(prefix) ? t.slice(prefix.length) : "");
  for (const t of unread.tables) {
    const name = bare(t);
    const bucket = PRZEMO_TABLES.includes(name) ? out.przemo : SCHEMA_COLUMNS[name] ? out.stock : out.unknown;
    bucket.tables.push(t);
  }
  for (const [t, cols] of Object.entries(unread.columns)) {
    const name = bare(t);
    for (const c of cols) {
      const bucket =
        PRZEMO_TABLES.includes(name) || PRZEMO_COLUMNS[name]?.includes(c)
          ? out.przemo
          : SCHEMA_COLUMNS[name]?.includes(c)
            ? out.stock
            : out.unknown;
      bucket.columns[t] ??= [];
      bucket.columns[t].push(c);
    }
  }
  out.przemo.config = unread.config.filter((k) => PRZEMO_CONFIG.includes(k));
  return out;
}
