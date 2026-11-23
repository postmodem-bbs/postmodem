# Beta — Import and 1.0

Status: **planned** · 2026-11-21 · after [M4](../DESIGN.md#10-delivery-plan), before 1.0.0 ·
[ADR 0024](../adr/0024-importer-work-in-the-beta-phase.md) · epic
[#108](https://github.com/postmodem-bbs/postmodem/issues/108)

## Goal

Every feature planned for 1.0 exists and is tested when Beta starts. Beta does two things:
it finishes moving phpBB2 / Przemo boards over, and it hardens the board on real data until
it can be released as **1.0.0**. Releases in this phase are `1.0.0-beta.N`.

## Starts when

- M2b (platform v0), [M2c](M2c.md) (vanilla parity), M3 (tier A, then tier B packages) and M4
  (Extension SDK v1) are done.
- Every package planned for 1.0 has e2e and axe coverage and can be enabled and disabled
  without breaking the core.

## Scope

- **Extension point #12, importer slices** ([EXTENSION-POINTS.md §13](../EXTENSION-POINTS.md#13-importer-slices--ep-12)):
  idempotent, resumable slices with a shared ID map. Added to the SDK as an additive change.
- **An importer slice for every tier A and tier B package** that has legacy data
  ([PACKAGES.md §2.11](../PACKAGES.md)), including the ones M2b packages would have
  brought, such as `reports` (`report_*`) and `unread-tracking` (`read_history`).
- **Import summary** names tier C data "not planned", and lists every legacy table, column
  or config key that no enabled slice read.
- **Checking the tiers:** the Przemo feature switches in real boards' report bundles are
  compared with the package tiers, and the tiers are adjusted where boards disagree.
- **Importer fixture** covers every table and column on the uninstaller's list, and runs in
  CI with every package enabled and with only `essentials`.
- **Real boards:** imports of volunteer boards (anonymised report bundles), fixes from what
  they turn up, and performance checks on the largest of them.
- **The import guide** ([guide/importing.md](../guide/importing.md)) is finished, and the importer loses its "experimental" label.

## Done when

- A Przemo 1.12 board imports with every tier A and B package's data, or the summary
  explains what was left out and why.
- Interrupted imports resume, and a second run of the import changes nothing.
- At least one real board has run on a beta for some time without data loss.
- 1.0.0 is released, signed, with release notes and an upgrade path from the betas.
