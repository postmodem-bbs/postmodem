# Developing Postmodem

Read [CONTRIBUTING.md](../../CONTRIBUTING.md) first: every commit is signed off (DCO), work is
tracked on the roadmap Project, and `main` only changes through pull requests. Coding agents
follow [AGENTS.md](../../AGENTS.md).

## From source

Node 24 and pnpm 12:

```bash
pnpm install
```

```bash
pnpm dev
```

The board runs at <http://localhost:5173> (the Vite dev server, live reload), on SQLite in
`var/data`. The board's command line runs on the same data:

```bash
pnpm cli doctor
```

A demo board to click through (every account signs in with one click, password
`postmodem-demo`):

```bash
pnpm cli demo
```

Everything generated locally goes under `var/` (ignored by git; [var/README.md](../../var/README.md)).
For another board beside it, set `POSTMODEM_DATA_DIR` to an absolute path (`pnpm dev` runs in
`apps/server`), e.g. `POSTMODEM_DATA_DIR=$PWD/var/try pnpm dev` and `POSTMODEM_DATA_DIR=$PWD/var/try pnpm cli demo`.

The production build, as the image runs it:

```bash
pnpm build
```

```bash
POSTMODEM_DATA_DIR=var/data node apps/server/build/postmodem.js run
```

That serves <http://localhost:8080>. `pnpm dev` and `pnpm cli` run the TypeScript sources
directly, while the build bundles them as the image does. Check a change in both when it
touches start-up, the CLI or anything loaded from disk.

## With Docker only

```bash
docker compose -f deploy/dev/compose.dev.yaml up --build --watch
```

This runs the board at <http://localhost:5173> from the image's `dev` target, with your
sources synced in, on **Postgres** (so it exercises the stack's database), and Mailpit at
<http://localhost:8025>, which shows every e-mail the board sends. The board starts empty:

```bash
docker compose -f deploy/dev/compose.dev.yaml exec app pnpm cli demo
```

The same setup opens as a **Dev Container** (`.devcontainer/`) in VS Code, JetBrains or
Codespaces. `--profile legacy` adds a phpBB2 / Przemo database to import from
([importing.md](importing.md)).

## Checks

```bash
pnpm check
```

Lint, the architecture rules, the Dockerfile's workspace list, typecheck, unit tests, SPDX
headers and dependency licences. CI runs the same, then builds the image and runs the
end-to-end suite against it.

The end-to-end and accessibility tests (Playwright with axe) run against a built board, as
CI runs them against the image. They browse the demo content, so seed it first, the way CI
does:

```bash
pnpm build
```

```bash
export POSTMODEM_DATA_DIR=var/e2e-data POSTMODEM_REGISTRATIONS_PER_IP_HOUR=0
```

```bash
pnpm cli seed-demo && pnpm cli settings set core.posting.floodSeconds 0 && pnpm cli settings set core.posting.perHour 0 && pnpm cli settings set core.search.perMinute 0
```

```bash
node apps/server/build/postmodem.js run
```

and in a second terminal:

```bash
pnpm e2e
```

| Variable | |
|---|---|
| `PM_BASE_URL` | the board under test (default `http://localhost:8080`) |
| `PW_BROWSERS` | `chromium` (default), `firefox`, `webkit`, comma-separated |
| `PM_ADMIN_PASSWORD` | the demo Admin's password, set with `pnpm cli user set-password Admin`; the admin tests skip without it |
| `PM_MAILPIT_URL` | Mailpit's address, for the tests that read e-mail |
| `PM_DEMO=1` | after `pnpm cli demo`: the demo sign-in and feature-tour specs |

## Changing something visible

Add it to the demo board's feature tour in the same pull request: content in
`apps/server/src/lib/server/demo-content.ts` and a check in `e2e/demo-tour.spec.ts`
([CONTRIBUTING.md, "Demo board"](../../CONTRIBUTING.md#demo-board)). To see it, rebuild your
demo board: stop it, then `pnpm cli demo --reset`.

## Where things are

| Path | What |
|---|---|
| `apps/server` | the SvelteKit web layer and the `postmodem` command line |
| `packages/core` | the framework-free domain: accounts, permissions, posting, settings |
| `packages/db` | SQLite (`node:sqlite`) and Postgres, migrations |
| `packages/modules` | the first-party packages (quick reply, reports, unread tracking…) |
| `packages/markup` | BBCode and the other post formats |
| `packages/importer` | the phpBB2 / Przemo importer |
| `packages/i18n` | translations (Fluent): English, Polish |
| `packages/ui` | theme tokens, contrast checks |
| `deploy/` | Compose files (solo, stack, dev), Caddy, the installer |
| `e2e/` | end-to-end and accessibility tests |
| `docs/` | these guides, the design documents and the [ADRs](../adr/) |
| `tools/` | the legacy fixtures, load tests, spikes ([tools/README.md](../../tools/README.md)) |
