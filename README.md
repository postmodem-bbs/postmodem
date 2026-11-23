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
  <a href="#try-it">Try it</a> ·
  <a href="docs/guide/install.md">Install</a> ·
  <a href="docs/guide/develop.md">Develop</a> ·
  <a href="docs/README.md">Docs</a> ·
  <a href="docs/milestones/">Milestones</a> ·
  <a href="https://postmodem-bbs.github.io/postmodem/">Website</a>
</p>

> **Status: an early preview (0.x). Not ready for production.** It is already a usable
> board: reading, posting, moderation, private messages, notifications, search, profiles
> with avatars, signatures and ranks, an admin panel, spam protection, and an
> **experimental** importer for phpBB2 / Przemo boards that keeps their links working (it's
> finished in the Beta phase before 1.0). Data formats may still change before 1.0:
> migrations carry a board forward, but there is no downgrade. See the
> [release notes](docs/releases/) for what's in each release, and the
> [milestones](docs/milestones/) for where it's going.

## What's in the box

|                     |                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| 📖 **Reading**      | phpBB2-style index, forums, topics and profiles; old phpBB2/Przemo links keep working                   |
| ✍️ **Writing**      | topics, replies, quotes, preview, BBCode toolbar, signatures                                            |
| 🛡️ **Moderating**   | lock, move, split, merge, sticky; bans by member, IP and e-mail; everything audited                     |
| 💬 **Members**      | profiles with avatars, signatures and ranks, private messages, watches, search, time zones, data export |
| 🧹 **Anti-spam**    | self-hosted proof-of-work, e-mail confirmation, invite-only mode, rate limits                           |
| 🧳 **Importing**    | phpBB2 / Przemo boards, passwords included (experimental, [guide](docs/guide/importing.md))             |
| 🐳 **Running it**   | one signed image; solo (SQLite) or stack (Postgres + Caddy); an installer; web admin and CLI            |
| ♿ **For everyone** | WCAG 2.2 AA, light and dark themes, English and Polish, no JavaScript required                          |

## Try it

A demo board on your machine, every account one click away (password `postmodem-demo`):

```bash
docker run -d --name postmodem-demo -p 8080:8080 -e POSTMODEM_DEMO=1 -v postmodem-demo:/data ghcr.io/postmodem-bbs/postmodem:edge
```

Then open <http://localhost:8080> and sign in from the sign-in page. The
[demo guide](docs/guide/demo.md) has a 15-minute tour, and how to run the demo from a
checkout or with the installer.

## Install

The installer asks a few questions, then starts a solo board (one container, SQLite) or a
stack (Postgres, Caddy with automatic HTTPS) and creates the first administrator:

```bash
curl -fsSL https://raw.githubusercontent.com/postmodem-bbs/postmodem/main/deploy/install.sh | sh
```

Or by hand, solo:

```bash
docker run -d --name postmodem -p 8080:8080 -v postmodem-data:/data --read-only --tmpfs /tmp ghcr.io/postmodem-bbs/postmodem:0.1
```

Images are signed with cosign. `:0.1` follows the latest 0.1.x release, and `:edge` is the
latest tested build of `main`. Inside the container, `postmodem` is the board's command line
(`docker exec -i postmodem postmodem doctor`).

| Guide                                   |                                                               |
| --------------------------------------- | ------------------------------------------------------------- |
| [Install](docs/guide/install.md)        | the installer, solo and stack by hand, behind a reverse proxy |
| [Configure](docs/guide/configure.md)    | `POSTMODEM_*` variables and board settings                    |
| [Run a board](docs/guide/administer.md) | the command line, backups, upgrades, before going public      |
| [Import](docs/guide/importing.md)       | from phpBB2 / Przemo (experimental)                           |

## Develop

With Node 24 and pnpm 12:

```bash
pnpm install
```

```bash
pnpm dev
```

The board runs at <http://localhost:5173> on SQLite in `var/data`; `pnpm cli demo` fills it
with the demo content, and `pnpm check` runs lint, typecheck, unit tests and the licence
checks. With Docker only, `docker compose -f deploy/dev/compose.dev.yaml up --build --watch`
runs the same on Postgres, with Mailpit for e-mail; it also opens as a Dev Container.

The [develop guide](docs/guide/develop.md) covers tests and where things are.
[CONTRIBUTING.md](CONTRIBUTING.md) has the rules: every commit signed off (DCO), work
tracked on the [roadmap Project](https://github.com/orgs/postmodem-bbs/projects/2), and a
visible change shows up on the demo board.

## Licence

AGPL-3.0-or-later for the board; Apache-2.0 for the extension SDK (once it
exists); CC-BY-4.0 for documentation. See [ADR 0010](docs/adr/0010-agpl-core-apache-sdk.md),
[CONTRIBUTING.md](CONTRIBUTING.md) (DCO sign-off required) and
[LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md). The extension exception is a draft and is
**not in force**: until its legal review is done ([#48](https://github.com/postmodem-bbs/postmodem/issues/48)), all of the board's code, extensions
included, is under the AGPL alone.

Found a security problem? Please report it privately; see [SECURITY.md](SECURITY.md).
Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
