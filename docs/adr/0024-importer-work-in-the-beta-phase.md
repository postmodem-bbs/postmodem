# ADR 0024 — Importer work moves to the Beta phase

- Status: accepted · 2026-11-21 · amends [ADR 0019](0019-package-tiers-and-essentials-profile.md)
  and the delivery plan ([DESIGN.md §10](../DESIGN.md#10-delivery-plan))

## Context

The Przemo importer came early (M1) so the board could be built and tested against
real-shaped data. That job is done: `postmodem import przemo` moves users, forums,
permissions, topics, posts, polls, private messages and more, and keeps old links working.

ADR 0019 then tied every tier A package to its own importer slice, built along with the
package. That doubles the work on each package before the board itself is complete, and it
shapes packages around legacy tables while their own design is still moving. Importing
matters to boards that are ready to switch, and nobody should switch until the board is
complete and stable.

## Decision

- A new **Beta** phase sits between M4 (Extension SDK v1) and the 1.0.0 release. It ships
  as `1.0.0-beta.N` pre-releases, then `1.0.0`. Federation and the marketplace (M5) follow
  1.0.
- M2b, M3 and M4 build packages and the SDK **without importer slices**. Extension point
  #12 (importer slices), every package's slice, the import summary's tiers and the report
  bundle's Przemo switches all move to Beta.
- The existing importer stays and its CI fixture suite keeps running, so it doesn't rot.
  It is marked **experimental** in the README and IMPORTING.md until Beta finishes it, and
  it gets no new features before then. Schema changes must still keep it passing.
- Beta starts once every feature planned for 1.0 is implemented and tested. Importing is
  finished there and tested against real boards, and 1.0.0 is released when it is done.

## Consequences

- Packages land sooner. Their importer slices are written later against a stable package
  schema, all in one phase.
- Until Beta, a board imported from Przemo gets only what the core importer moves today.
  Data for packages built in M2b–M4 is reported as not imported.
- The SDK freezes in M4 without the importer-slice API. EP-12 is added in Beta as an
  additive change, so it doesn't break extensions built on SDK v1.
- A third-party package can't ship an importer slice before Beta.
