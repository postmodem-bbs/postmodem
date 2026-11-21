<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/banner-dark.svg">
    <img src="docs/brand/banner-light.svg" alt="Postmodem: classic forum layout, modern internals" width="100%">
  </picture>
</h1>

<p align="center">
  <a href="https://github.com/postmodem-bbs/postmodem/releases"><img alt="Release" src="https://img.shields.io/github/v/release/postmodem-bbs/postmodem?include_prereleases&style=for-the-badge&label=release&color=006699"></a>
  <a href="https://github.com/postmodem-bbs/postmodem/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/postmodem-bbs/postmodem/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=CI"></a>
  <a href="https://github.com/postmodem-bbs/postmodem/actions/workflows/dco.yml"><img alt="DCO" src="https://img.shields.io/badge/DCO-sign--off_required-4a5560?style=for-the-badge"></a>
  <a href="#licence"><img alt="Licence: AGPL-3.0-or-later" src="https://img.shields.io/badge/licence-AGPL--3.0--or--later-2b333a?style=for-the-badge"></a>
  <a href="https://postmodem-bbs.github.io/postmodem/"><img alt="Website" src="https://img.shields.io/badge/website-postmodem--bbs.github.io-6cb8e6?style=for-the-badge&logo=githubpages&logoColor=white"></a>
</p>

<p align="center">
  <img alt="Status: early preview" src="https://img.shields.io/badge/status-early_preview-ec8a2c?style=for-the-badge">
  <a href="https://github.com/postmodem-bbs/postmodem/pkgs/container/postmodem"><img alt="Container: ghcr.io" src="https://img.shields.io/badge/ghcr.io-one_image-006699?style=for-the-badge&logo=docker&logoColor=white"></a>
  <img alt="Signed with cosign" src="https://img.shields.io/badge/signed-cosign-4a5560?style=for-the-badge&logo=sigstore&logoColor=white">
  <img alt="WCAG 2.2 AA" src="https://img.shields.io/badge/WCAG_2.2-AA-006699?style=for-the-badge">
  <img alt="Works without JavaScript" src="https://img.shields.io/badge/works_without-JavaScript-2b333a?style=for-the-badge">
  <img alt="Languages: English, Polish" src="https://img.shields.io/badge/i18n-EN_·_PL-4a5560?style=for-the-badge">
</p>

<p align="center">
  <img alt="Node.js 24" src="https://img.shields.io/badge/Node.js-24-2b333a?style=for-the-badge&logo=nodedotjs&logoColor=white">
  <img alt="pnpm 12" src="https://img.shields.io/badge/pnpm-12-2b333a?style=for-the-badge&logo=pnpm&logoColor=white">
  <img alt="SvelteKit" src="https://img.shields.io/badge/SvelteKit-3-2b333a?style=for-the-badge&logo=svelte&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-2b333a?style=for-the-badge&logo=typescript&logoColor=white">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-2b333a?style=for-the-badge&logo=sqlite&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-2b333a?style=for-the-badge&logo=postgresql&logoColor=white">
</p>

<p align="center">
  A modern bulletin board in the tradition of phpBB2 "modified by Przemo":<br>
  <b>batteries included, every battery removable, trivially self-hosted.</b><br>
  Classic forum layout, modern internals: accessible, themeable, extensible,
  works without JavaScript, and ships as one Docker image.
</p>

<p align="center">
  <a href="#run-it">Run it</a> ·
  <a href="#develop">Develop</a> ·
  <a href="docs/DESIGN.md">Design</a> ·
  <a href="docs/milestones/">Milestones</a> ·
  <a href="docs/releases/0.1.0.md">0.1.0 notes</a> ·
  <a href="https://postmodem-bbs.github.io/postmodem/">Website</a>
</p>

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

## What's in the box

|                     |                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------- |
| 📖 **Reading**      | phpBB2-style index, forums, topics and profiles; old phpBB2/Przemo links keep working |
| ✍️ **Writing**      | topics, replies, quotes, preview, BBCode toolbar, signatures                          |
| 🛡️ **Moderating**   | lock, move, split, merge, sticky; bans by member, IP and e-mail; everything audited   |
| 💬 **Members**      | private messages, watches with e-mail notifications, search, data export              |
| 🧹 **Anti-spam**    | self-hosted proof-of-work, e-mail confirmation, invite-only mode, rate limits         |
| 🧳 **Importing**    | phpBB2 / Przemo boards, passwords included (experimental, [guide](docs/IMPORTING.md)) |
| 🐳 **Running it**   | one signed image; solo (SQLite) or stack (Postgres + Caddy); web admin and CLI        |
| ♿ **For everyone** | WCAG 2.2 AA, light and dark themes, English and Polish, no JavaScript required        |

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
