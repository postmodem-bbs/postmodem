# Vendored Przemo schema

These two files are copied **byte-for-byte** from phpBB2 "modified by Przemo"
**v1.12.9** (`db/schemas/` in the original package). They are the starting
point of every legacy fixture: the generator loads them first, exactly as
Przemo's installer did, then adds generated content.

| File               | SHA-256                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `mysql_schema.sql` | `0bac8bc2a0d5c52535735a9b4193c28b5c4da4c11c531894036d6d6d608df4d6` |
| `mysql_basic.sql`  | `0d23084cfce147e7230b065f54d784df04192aa73799867bbbdf5cb4481a3593` |

- **Licence:** GPL-2.0-or-later (© the phpBB Group and Przemo), see
  [LICENSES/GPL-2.0-or-later.txt](../../../../LICENSES/GPL-2.0-or-later.txt).
  Combining them with Postmodem's AGPL-3.0-or-later code is permitted by the
  "or later" clause ([ADR 0010](../../../../docs/adr/0010-agpl-core-apache-sdk.md)).
- **Encoding:** `mysql_basic.sql` is ISO-8859-2 (latin2), like the original
  tables. Load it with `--default-character-set=latin2`. Don't re-save these
  files in an editor; the hashes above must keep matching.
- They are test fixtures only and never ship in the Postmodem image.
