# ADR 0010 — AGPL-3.0 core, Apache-2.0 SDK, DCO contributions

- Status: accepted · 2026-11-17

## Context
Postmodem is a clean-room rewrite, so its licence is a free choice. Three facts
shaped it:
- The legacy package is **GPL-2.0-or-later**. Its reusable assets (images,
  smilies, rank icons, Polish strings) can only go into a GPL-3.0/AGPL-3.0
  project.
- Postmodem is server software. Plain GPL only requires sharing changes when copies
  are distributed, so a closed hosted fork would be allowed.
- Tier-2 modules run in-process. Under a GPL-family licence they could be
  argued to be derived works, which would discourage an add-on ecosystem.

## Decision

| Part | Licence |
|---|---|
| Core, first-party modules, add-ons and themes (`apps/*`, `packages/core`, `packages/db`, `packages/ui`, `extensions/*`, `themes/*`) | **AGPL-3.0-or-later** |
| Extension SDK, types, test kit, manifest schema, example add-ons (`packages/sdk`, `packages/sdk-testing`, `schemas/*`, `examples/*`) | **Apache-2.0** |
| Documentation (`docs/*`) | **CC-BY-4.0** |
| Assets reused from the legacy package | keep **GPL-2.0-or-later** notices, combined under AGPL-3.0 |

- **Extension exception:** the core's licence carries an additional
  permission (AGPL §7) stating that add-ons and modules interacting with Postmodem
  only through `@postmodem/sdk` and the documented HTTP/bridge APIs are not
  considered derived works and may use any licence. *Wording to be reviewed by
  someone with legal expertise before the first public release.*
- **Compliance made easy:** every page footer has a "Source" link to the exact
  version's source (from the image's OCI labels). Admins who run a modified
  build point it at their own source in the ACP. Running Postmodem unmodified
  requires nothing further.
- **Contributions** use the **DCO** (`Signed-off-by:` on every commit, checked
  in CI). No CLA: no one, including the maintainers, can relicense the core
  later without contributors' consent.
- Every source file carries an SPDX header; CI checks headers and dependency
  licence compatibility (Apache-2.0, MIT, BSD, ISC, MPL-2.0 OK for the core;
  anything GPL-incompatible fails the build).

## Consequences
- Hosted forks of Postmodem must share their improvements (as with Mastodon and Lemmy).
- The add-on ecosystem can include closed or permissively licensed add-ons.
- The Classic theme and Polish translation may reuse legacy material,
  provided the notices are kept.
- Some companies avoid AGPL software; accepted, since the target audience is
  self-hosting communities.
- The licence choice is effectively permanent once outside contributions arrive.
