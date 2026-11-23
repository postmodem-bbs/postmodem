# Running a board

## The command line

The image's entrypoint is the `postmodem` command line; one image, many roles. The same
commands run in every setup, called differently:

| Where the board runs | `postmodem doctor` is |
|---|---|
| a container named `postmodem` (`docker run`) | `docker exec -i postmodem postmodem doctor` |
| solo with Compose (the installer) | `docker compose -f compose.solo.yaml exec -T postmodem postmodem doctor` |
| a stack | `docker compose exec -T web postmodem doctor` |
| a source checkout | `pnpm cli doctor` (data in `var/data`; set `POSTMODEM_DATA_DIR` for another) |
| a build (`pnpm build`) | `node apps/server/build/postmodem.js doctor` |

`postmodem help` lists every command with its options. In short:

| Command | Purpose |
|---|---|
| `run` | web + worker + scheduler in one process (solo; the default) |
| `web`, `worker`, `scheduler` | one role each, for the stack |
| `migrate` | apply the database migrations (safe to run concurrently) |
| `init` | the first administrator, from `POSTMODEM_ADMIN_*` (does nothing if there is one) |
| `doctor` | check configuration, data directory, database, migrations, mail, demo mode |
| `config print` | the effective configuration and where each value came from, secrets hidden |
| `user set-password <name>` | set a password (prompted, from stdin or `--password-file`); signs them out everywhere |
| `ban`, `invite`, `group`, `forum` | the ban list, invite links, groups and the forum tree |
| `packages list \| enable \| disable` | the installed packages and which are on |
| `settings list \| get \| set` | board settings ([configure.md](configure.md#board-settings)) |
| `perms explain` | why a member may or may not do something in a forum, and which grants decided it |
| `backup`, `restore` | [below](#backups) |
| `search rebuild` | rebuild the search index |
| `import przemo` | move a phpBB2 / Przemo board over, experimental ([importing.md](importing.md)) |
| `demo`, `seed-demo` | the [demo board](demo.md) |
| `healthcheck`, `version` | used by Docker's `HEALTHCHECK`; the version and revision |

## Backups

**Solo (SQLite):** `postmodem backup` writes a consistent copy while the board runs (SQLite
`VACUUM INTO`) plus the uploads, into `/data/backups/<time>/` (or a directory you name):

```bash
docker compose -f compose.solo.yaml exec postmodem postmodem backup
```

Copy `/data/backups` somewhere else (another disk, another machine): a backup on the same
volume doesn't survive losing the volume. To restore, stop the board, then

```bash
docker compose -f compose.solo.yaml run --rm postmodem restore /data/backups/<time>
docker compose -f compose.solo.yaml up -d
```

The database and uploads it replaces are kept as `*.before-restore` until the next restore.

**Stack (Postgres):** the same command uses the image's PostgreSQL 18 client and the
board's database credentials. It writes a custom-format `postmodem.dump`, the uploads, and
`manifest.json`. An explicit destination must be new or empty. Copy the backup off the board's
volume:

```bash
docker compose exec -T web postmodem backup /data/backups/nightly
docker compose cp web:/data/backups/nightly ./nightly
```

To recover, stop the board's web, worker, and scheduler services. Restore the archive to a new, empty
database and make the backed-up uploads available at `/data/uploads` in the board's data volume
before starting it with the new database URL. Keep the original database and uploads until you
verify recovery. For the default Compose roles:

```bash
docker compose stop web worker scheduler
docker compose exec -T db createdb -U postmodem postmodem_restore
docker compose exec -T db pg_restore -U postmodem -d postmodem_restore \
  --single-transaction --no-owner --no-acl < ./nightly/postmodem.dump
```

The CLI's `restore` command handles SQLite. For Postgres use `pg_restore` from PostgreSQL 18 or
later. A source installation needs `pg_dump` on its PATH, at least as new as the server. The
archive covers the board database. Back up deployment configuration and secrets separately.
Uploads are copied as files after the database snapshot, so pause writes during backup if the
archive must capture both at the same instant. The board does not send backups off-host.

## Upgrades

Pull the new image (or set `POSTMODEM_IMAGE` in `.env` to a new version) and start the board
again:

```bash
docker compose pull && docker compose up -d
```

`migrate` runs first, and the web, worker and scheduler services start only after it
succeeds; solo mode migrates in-process when it starts. Back up before upgrading: there is no
downgrade. Releases change the database in expand/contract steps (a release never drops what
the previous one still reads), so a one-version rollback of the image works without restoring
the data. The release notes in [docs/releases/](../releases/) say what changed.

## Before going public

1. Real mail (`POSTMODEM_MAIL_URL`): without it nobody can confirm an account.
2. HTTPS: the stack's Caddy, or your own proxy ([install.md](install.md#behind-a-reverse-proxy)).
3. Never a demo board. If the board started from the demo, `postmodem doctor` says so: turn it
   off with `postmodem settings set core.demo.enabled false`, and change or ban the demo
   accounts (`postmodem user set-password <name>`, `postmodem ban user <name>`). Better: start
   from an empty board.
4. Invite-only while you start (`postmodem settings set core.registration.inviteOnly true`,
   links from **Admin** → Bans and invites or `postmodem invite create`).
5. The privacy notice: **Admin** → Board settings, if the built-in one doesn't fit; name who
   runs the board in it.
6. Scheduled backups, copied off the machine, and `/readyz` in your monitoring.

Spam protection is on by default: a proof-of-work check on registration, e-mail confirmation,
no links or private messages for new members' first posts, and limits on posts, searches,
sign-ins and registrations per member and per address.
