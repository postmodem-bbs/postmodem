# Moving a phpBB2 / Przemo board to Postmodem

The importer reads your old board's MySQL/MariaDB database directly and fills a **fresh**
Postmodem board. Your old board stays untouched: run the import as often as you like.

## 1. Start a fresh board, but don't create an admin

Start Postmodem (solo or stack) as usual, but skip `postmodem init`: your old
administrators come along and keep their passwords.

## 2. Try a dry run

From the same machine or container, with a database user that can read the old tables:

```bash
docker compose exec postmodem /nodejs/bin/node /app/postmodem.js import przemo \
  --source 'mysql://user:password@old-db-host:3306/forum' --dry-run
```

- `--prefix phpbb_` if your tables use another prefix (`$table_prefix` in `config.php`).
- `--charset latin2|cp1250|utf8` only if the report shows text decoded the wrong way; by
  default every value is checked on its own, because old boards often mix them.
- Put the URL in a file and use `POSTMODEM_IMPORT_SOURCE_FILE` to keep the password out of
  your shell history.

The dry run reads and converts everything, then throws it away, and prints a summary. The
full report is written to the data directory (or `--report <file>`).

## 3. Import

Run the same command without `--dry-run`. If it stops (network, disk, a crash), run it
again: it continues where it stopped. A board of 200,000 posts takes a few minutes.

## 4. Read the report

- **Issues** are the oddities the importer found and handled: posts whose topic was
  deleted, posts by deleted users, text stored in the wrong charset, counters phpBB2 got
  wrong. Each lists example ids, never content.
- **Not imported** lists every table, column and setting the core didn't read. Most belong
  to packages (polls, private messages, attachments, Przemo's extras) that will import their
  own data. If something is missing that you need, open an issue.
- Attach the file from `--report-bundle <file>` to bug reports: it holds no names or text.

## What carries over

Users (with their passwords: old MD5 and phpass hashes are upgraded at first sign-in),
groups and memberships, ranks, smilies (copy their images over), categories and forums
including Przemo sub-forums, forum permissions, topics and posts with their original
numbers, so old links like `viewtopic.php?t=123` keep working, and the board name,
description and default language.
