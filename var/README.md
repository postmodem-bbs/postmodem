# var/

Everything generated lives here and is ignored by git (except this file):

| Path | Written by |
|---|---|
| `var/data/` | `pnpm dev` (local SQLite board, generated secret key) |
| `var/test-results/`, `var/playwright-report/` | `pnpm e2e` |
| `var/fixtures/` | `pnpm fixtures:generate` (legacy Przemo dumps + manifests) |

`rm -rf var/*` (keeping this README) resets your local state.
