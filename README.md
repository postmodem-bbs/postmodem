# Postmodem

A modern bulletin board in the tradition of phpBB2 "modified by Przemo":
batteries included, every battery removable, trivially self-hosted.
Classic forum layout, modern internals: accessible, themeable, extensible,
works without JavaScript, and ships as one Docker image.

> **Status: 0.1.0, an early preview. Not ready for production.** It is already a usable
> board: reading, posting, moderation, private messages, notifications, search, an admin
> panel, spam protection, and an **experimental** importer for phpBB2 / Przemo boards that
> keeps their links working (it's finished in the Beta phase before 1.0). Data formats may
> still change before 1.0. Migrations carry a board forward, but there is no downgrade. The project doesn't run a public board of its own yet; that waits
> for a more complete build ([M2.md, decision 5](docs/milestones/M2.md)). See the
> [0.1.0 release notes](docs/releases/0.1.0.md) for what's in it and what isn't yet, and
> the [milestones](docs/milestones/) and [design](docs/DESIGN.md) for where it's going.
> [CONTAINERS.md §4.6](docs/CONTAINERS.md#46-a-public-staging-board-m2a) covers running a
> test board in public.
>
> Try it with demo content: `pnpm cli seed-demo`, then `pnpm dev`
> (or `postmodem seed-demo` inside the container). Demo members `Łukasz Żółć`,
> `retro_fan` and `Ola` sign in with the password `postmodem-demo`. New accounts confirm
> their e-mail address: set `POSTMODEM_MAIL_URL` (the dev stack's Mailpit at
> http://localhost:8025 shows every message), or find the link in the log with the
> default `log://`.

## Run it

**Solo** (one container, SQLite, data in a named volume):

```bash
docker run -d --name postmodem -p 8080:8080 -v postmodem-data:/data --read-only --tmpfs /tmp ghcr.io/postmodem-bbs/postmodem:0.1
```

Images are signed with cosign. `:0.1` follows the latest 0.1.x release, and `:edge` is the
latest tested build of `main`.

**Stack** (Postgres, Caddy with automatic HTTPS, several web replicas): see
[deploy/compose.yaml](deploy/compose.yaml) and [deploy/.env.example](deploy/.env.example).

```bash
cd deploy && docker compose up -d
```

To run your own build instead, run
`docker build --target runtime -t postmodem:local .` and set
`POSTMODEM_IMAGE=postmodem:local`.

### Commands

The image's entrypoint is the `postmodem` CLI. One image, many roles:

| Command                        | Purpose                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `run`                          | web + worker + scheduler in one process (default, solo mode)                 |
| `web` / `worker` / `scheduler` | single roles for stack mode                                                  |
| `migrate`                      | apply database migrations (safe to run concurrently)                         |
| `init`                         | create the first administrator from `POSTMODEM_ADMIN_*` (idempotent)         |
| `seed-demo`                    | fill an empty board with demo content (refuses if forums exist)              |
| `import przemo`                | move a phpBB2 / Przemo board over, experimental ([guide](docs/IMPORTING.md)) |
| `perms explain`                | why a user may or may not do something in a forum                            |
| `user set-password <name>`     | set a password (prompted without echo, or `--password-file`)                 |
| `doctor`                       | check configuration, data directory, database, migrations                    |
| `healthcheck`                  | used by Docker's `HEALTHCHECK`                                               |
| `config print`                 | effective configuration and where each value came from, secrets redacted     |

```bash
docker exec postmodem /nodejs/bin/node /app/postmodem.js doctor
```

Configuration is environment-first (`POSTMODEM_*`, with `*_FILE` variants for
Docker secrets), optionally from `/data/postmodem.toml`. See
[docs/CONTAINERS.md §3](docs/CONTAINERS.md).

## Develop

Docker is the only requirement:

```bash
docker compose -f deploy/dev/compose.dev.yaml up --build --watch
```

This runs the board at <http://localhost:5173> (Vite dev server, live sync),
Postgres, and Mailpit at <http://localhost:8025>. The same setup opens as a
**Dev Container** (`.devcontainer/`) in VS Code, JetBrains or Codespaces.

With Node 24 and pnpm 12 installed locally instead:

```bash
pnpm install
pnpm dev            # http://localhost:5173, SQLite in ./data
pnpm check          # lint, architecture rules, typecheck, unit tests, SPDX, licences
pnpm e2e            # Playwright + axe against a running board (PM_BASE_URL)
```

## Repository layout

| Path            | What                                                                       |
| --------------- | -------------------------------------------------------------------------- |
| `apps/server`   | SvelteKit web layer and the `postmodem` CLI                                |
| `packages/core` | framework-free domain: config, typed settings, logging                     |
| `packages/db`   | SQLite (`node:sqlite`) and Postgres adapters, migrations                   |
| `packages/i18n` | Fluent translations (English, Polish)                                      |
| `packages/ui`   | theme tokens → CSS, contrast checks                                        |
| `deploy/`       | Compose files (solo, stack, dev) and Caddy config                          |
| `e2e/`          | end-to-end and accessibility tests                                         |
| `docs/`         | design documents and [ADRs](docs/adr/)                                     |
| `tools/`        | fixtures generator, load tests, spikes ([tools/README](tools/README.md))   |
| `var/`          | everything generated locally; ignored by git ([var/README](var/README.md)) |

## Licence

AGPL-3.0-or-later for the board; Apache-2.0 for the extension SDK (once it
exists); CC-BY-4.0 for documentation. See [ADR 0010](docs/adr/0010-agpl-core-apache-sdk.md),
[CONTRIBUTING.md](CONTRIBUTING.md) (DCO sign-off required) and
[LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md). The extension exception is a draft and is
**not in force**: until its legal review is done ([#48](https://github.com/postmodem-bbs/postmodem/issues/48)), all of the board's code, extensions
included, is under the AGPL alone.

Found a security problem? Please report it privately; see [SECURITY.md](SECURITY.md).
Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
