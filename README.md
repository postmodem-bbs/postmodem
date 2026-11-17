# Postmodem

A modern bulletin board in the tradition of phpBB2 "modified by Przemo":
batteries included, every battery removable, trivially self-hosted.
Classic forum layout, modern internals: accessible, themeable, extensible,
works without JavaScript, and ships as one Docker image.

> **Status: M1 in progress.** Read-only board: index, forums (with Przemo-style
> sub-forums) and topics on phpBB2's own URLs, posts rendered from BBCode, per-forum
> permissions, registration and sign-in. No posting yet. See
> [docs/milestones/M1.md](docs/milestones/M1.md).
>
> Try it with demo content: `pnpm cli seed-demo`, then `pnpm dev`
> (or `postmodem seed-demo` inside the container). Demo members `Łukasz Żółć`,
> `retro_fan` and `Ola` sign in with the password `postmodem-demo`.

## Run it

**Solo** (one container, SQLite, data in a named volume):

```bash
docker run -d --name postmodem -p 8080:8080 -v postmodem-data:/data --read-only --tmpfs /tmp ghcr.io/postmodem-bbs/postmodem:edge
```

**Stack** (Postgres, Caddy with automatic HTTPS, several web replicas): see
[deploy/compose.yaml](deploy/compose.yaml) and [deploy/.env.example](deploy/.env.example).

```bash
cd deploy && docker compose up -d
```

The image is not published yet; until it is, build it locally with
`docker build --target runtime -t postmodem:local .` and set
`POSTMODEM_IMAGE=postmodem:local`.

### Commands

The image's entrypoint is the `postmodem` CLI. One image, many roles:

| Command                        | Purpose                                                                  |
| ------------------------------ | ------------------------------------------------------------------------ |
| `run`                          | web + worker + scheduler in one process (default, solo mode)             |
| `web` / `worker` / `scheduler` | single roles for stack mode                                              |
| `migrate`                      | apply database migrations (safe to run concurrently)                     |
| `init`                         | create the first administrator from `POSTMODEM_ADMIN_*` (idempotent)     |
| `seed-demo`                    | fill an empty board with demo content (refuses if forums exist)          |
| `perms explain`                | why a user may or may not do something in a forum                        |
| `doctor`                       | check configuration, data directory, database, migrations                |
| `healthcheck`                  | used by Docker's `HEALTHCHECK`                                           |
| `config print`                 | effective configuration and where each value came from, secrets redacted |

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
[LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md) (draft, pending legal review).
