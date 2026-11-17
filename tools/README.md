# tools/

Auxiliary tooling that changes together with the product but never ships in
the Postmodem image. Generated output goes to [`var/`](../var/README.md), never here.

| Path                     | What                                                                                                                                       | How                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [`fixtures/`](fixtures/) | Deterministic legacy boards (phpBB2 "modified by Przemo" 1.12.9) for importer and performance tests, published as preloaded MariaDB images | `pnpm fixtures:generate --preset small`, `pnpm fixtures:image --preset small --smoke` |
| [`loadtest/`](loadtest/) | k6 scenarios for the performance budget (DESIGN §5.1)                                                                                      | see the header of `smoke.js`                                                          |
| [`spikes/`](spikes/)     | Throwaway experiments that informed ADRs 0007 and 0008; kept as evidence, not maintained                                                   | see each `SPIKE.md` / README                                                          |

## Fixtures

Presets: `tiny` (tests), `small` (~4k posts: dev, e2e, importer CI) and
`large` (~200k posts: performance). Each run writes to `var/fixtures/`:

- `przemo-<preset>-s<seed>-g<generator>.sql.gz`: the dump, loaded on top of
  Przemo's own [schema and install data](fixtures/przemo/schema/), and
- a `.manifest.json` describing what's inside: counts, test accounts with
  their plaintext passwords, forums by access model, and every deliberate
  **quirk** (cp1250 or UTF-8 bytes in latin2 columns, HTML entities, broken
  BBCode, anonymous and dangling posters, orphans, stale counters, missing
  smiley images, moved-topic shadows) with the row it's in. Importer tests
  assert against the manifest, not against guesses.

Images: `ghcr.io/postmodem-bbs/fixture-przemo:<version>-<preset>`, built and
published by [`.github/workflows/fixtures.yml`](../.github/workflows/fixtures.yml)
whenever `tools/fixtures/` changes. Credentials are public fixture
credentials: `przemo` / `przemo`, database `przemo`. Use it in the dev stack:

```bash
docker compose -f deploy/dev/compose.dev.yaml --profile legacy up -d legacy
```

Bump `version` in `fixtures/package.json` whenever the output for a seed
changes, so published images stay reproducible.
