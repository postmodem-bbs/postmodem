# ADR 0018 — Importing phpBB2/Przemo: keep ids, decode per value, self-contained forum grants

- Status: accepted · 2026-11-17 (M1 slice 6)

## Context
Every Przemo board that moves to Postmodem goes through this importer once, usually with no
second chance to compare. Links to the old board live on in search engines and other sites.
Real databases mix charsets inside one latin2 column, carry phpBB2's HTML escaping, leave
orphans behind, and express permissions as per-forum levels that don't map one-to-one onto
roles. No real board database is available, so the generated fixture (tools/fixtures) with
its manifest of planted quirks is the reference.

## Decision
- **Read the source directly** (MySQL/MariaDB through `mysql2`, pure JS), inside the
  Postmodem image: `postmodem import przemo --source mysql://…`. No export step, nothing
  else to install. Text arrives as raw bytes (`character_set_results = binary`).
- **Decode per value:** latin2, Windows-1250 or UTF-8-stored-as-latin2, whichever reading
  looks like real text (Polish letters up, impossible characters down; ties to latin2).
  `--charset` forces one. Repairs are counted in the report. HTML entities are undone once.
- **Keep ids** of users, forums, topics and posts, so `viewtopic.php?t=…`, `?p=…`,
  `viewforum.php?f=…` and profile links keep pointing at the same things. Categories share
  the node table with forums, so they get new ids, mapped in `legacy_ids`.
- **Tree:** a Przemo sub-forum category (a category whose parent is a forum) disappears; its
  forums sit directly under the forum, as Postmodem shows sub-forums. Categories nested in
  categories stay, and the index lists them as their own sections ("Parent › Child").
- **Permissions** (ADR 0015): each forum gets its own complete set of grants: everyone
  (allow what was ALL, explicitly deny the rest, so a sub-forum never inherits its parent),
  registered (ALL and REG), each `auth_access` group or user (ACL actions; moderators also
  MOD actions and `moderate.*`), and an imported administrators group (everything, since
  phpBB2 admins bypassed forum auth). Identical capability sets share one imported role.
  Attachment, download and global-announcement levels belong to packages and are reported.
- **Passwords** are copied as they are (MD5 or phpass) and upgraded on first sign-in.
- **Robust to mess:** orphan posts and topics are skipped and reported; posts by deleted
  users keep their name text; counters are recomputed and stale legacy ones reported;
  duplicate e-mail addresses are emptied on the later account.
- **Resumable:** each step and batch commits with its checkpoint (`legacy_ids`), so running
  the same command again continues. It refuses a board that already has content unless it is
  resuming. `--dry-run` reads and maps everything in a transaction that is rolled back.
- **The report** lists counts, encodings, issues (ids only, never content) and everything
  not read: tables, columns, config keys. `--report-bundle` writes the same without board
  settings, for bug reports.

## Consequences
- Post subjects (per-post titles), polls, private messages, attachments, avatars and all
  Przemo extras are not imported by the core; the report lists them for their packages.
- Smiley images and avatars must be copied from the old board's files (a later step).
- Users with no usable hash, or whose e-mail was emptied, must use password reset.
- The import must run before `postmodem init` (the imported admins are the admins).
