# Configuring a board

A board has two kinds of settings:

- **Infrastructure**: where it runs, its database, mail, search. Set by whoever runs the
  container, never from the browser. Read at start-up.
- **Board settings**: name, registration, posting limits, URL style, packages and the rest.
  Changed in the admin panel (**Admin** → Board settings) or with `postmodem settings`.
  Running servers pick changes up within a few seconds.

## Infrastructure

Each setting comes from, in order (later wins): its default, `/data/postmodem.toml`, a
`POSTMODEM_*` environment variable, then `POSTMODEM_*_FILE` (the value read from a file, for
Docker secrets). Invalid configuration stops the board at start-up with a message naming the
variable. A misspelt `POSTMODEM_*` variable gets a warning with the likely intended name.

`postmodem config print` shows the effective configuration and where each value came from,
with secrets hidden. `postmodem doctor` checks it along with the data directory, database,
migrations and mail.

| Variable | Default | What it is |
|---|---|---|
| `POSTMODEM_PUBLIC_URL` | `http://localhost:8080` | the board's address exactly as visitors type it (links in e-mails, cookies) |
| `POSTMODEM_DATA_DIR` | `/data` | where the SQLite database, uploads, backups and the generated secret key live |
| `POSTMODEM_DATABASE_URL` | `sqlite://<data>/db/postmodem.sqlite` | or `postgres://user@host:5432/db` |
| `POSTMODEM_DATABASE_PASSWORD(_FILE)` | | the Postgres password, kept out of the URL |
| `POSTMODEM_SECRET_KEY(_FILE)` | generated into `<data>/secrets` | signs sessions and tokens; at least 32 characters. Every replica of a stack must share it |
| `POSTMODEM_HOST`, `POSTMODEM_PORT` | `0.0.0.0`, `8080` | where the web server listens |
| `POSTMODEM_MAIL_URL` | `log://` | `smtp://user:pass@host:587` or `smtps://…:465`; `log://` writes e-mails to the log instead |
| `POSTMODEM_MAIL_FROM` | `noreply@<public host>` | the sender, e.g. `"Our Board" <forum@example.org>` |
| `POSTMODEM_PROFILE` | `essentials` | the packages that are on until an admin picks: `vanilla` (none), `essentials` or `przemo` ([PACKAGES.md §5](../PACKAGES.md)) |
| `POSTMODEM_REGISTRATIONS_PER_IP_HOUR` | `10` | registrations one address may make per hour before delays start; `0` for none (LAN parties, schools, CI) |
| `POSTMODEM_SEARCH_URL` | `builtin://` | the database's own search, or `meilisearch://search:7700` with `--profile search` |
| `POSTMODEM_SEARCH_KEY(_FILE)` | | the Meilisearch API key |
| `POSTMODEM_COUNTERS_URL` | `memory://` | view counters' buffer; `valkey://valkey:6379` shares it between replicas (`--profile scale`) |
| `POSTMODEM_REALTIME_URL` | `memory://` (SQLite), `postgres://` (Postgres) | live updates between processes; or `valkey://valkey:6379` |
| `POSTMODEM_TRUSTED_PROXIES` | | proxy addresses or CIDRs, comma-separated ([install.md](install.md#behind-a-reverse-proxy)) |
| `POSTMODEM_PROXY_HOPS` | `0` (`1` with trusted proxies) | how many proxies stand between visitors and the board |
| `POSTMODEM_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `POSTMODEM_SOURCE_URL` | this release's source on GitHub | the footer's "Source code" link (AGPL); set it if you run modified code |
| `POSTMODEM_DEMO` | off | `1`: an empty board starts as the [demo](demo.md). Never for a real board |

Used once, by `postmodem init` (the first administrator): `POSTMODEM_ADMIN_USERNAME` (default
`admin`), `POSTMODEM_ADMIN_EMAIL`, `POSTMODEM_ADMIN_PASSWORD(_FILE)`.

Accepted but not used yet (planned, [CONTAINERS.md §3](../CONTAINERS.md#3-configuration)):
`POSTMODEM_CACHE_URL`, `POSTMODEM_QUEUE`, `POSTMODEM_STORAGE_URL`, `POSTMODEM_AV_URL`,
`POSTMODEM_EXTENSIONS`.

The same settings in `/data/postmodem.toml` use lower-case names without the prefix:

```toml
public_url = "https://forum.example.org"
mail_url = "smtp://forum:secret@mail.example.org:587"
log_level = "info"
```

## Board settings

```bash
postmodem settings list
```

```bash
postmodem settings set core.registration.inviteOnly true
```

Values are JSON, or plain text for strings. The ones people change most:

| Setting | Default | |
|---|---|---|
| `core.board.name`, `core.board.description` | `Postmodem`, empty | shown in the header and page titles |
| `core.board.defaultLocale` | `en` | `en` or `pl`; each member can pick their own |
| `core.board.defaultTheme` | `classic` | each member and guest can pick their own |
| `core.registration.open`, `core.registration.inviteOnly` | `true`, `false` | invite links: `postmodem invite create` |
| `core.registration.verifyEmail` | `true` | new accounts confirm their e-mail address |
| `core.newMembers.posts` | `3` | until then: no links in posts, no private messages |
| `core.posting.floodSeconds`, `core.posting.perHour` | `15`, `30` | seconds between a member's posts, and posts per hour |
| `core.urls.style` | `classic` | `classic` (phpBB2's `viewtopic.php?t=3`), `numbered` or `slug` ([ADR 0012](../adr/0012-configurable-permalinks.md)) |
| `core.packages.enabled` | the profile's list | rather: `postmodem packages enable <key>` |
| `core.demo.enabled` | `false` | set by `postmodem demo`: the sign-in page offers the demo accounts |
