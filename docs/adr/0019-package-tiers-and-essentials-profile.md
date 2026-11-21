# ADR 0019 — Package tiers, and `essentials` as the default profile

- Status: accepted · 2026-11-18 · amends [PACKAGES.md §5](../PACKAGES.md#5-distribution-profiles) ·
  amended by [ADR 0024](0024-importer-work-in-the-beta-phase.md): importer slices move to the Beta phase

## Context
PACKAGES.md splits Przemo into about 75 packages and made the `przemo` profile (every one of
them, switched on) the default for new and imported boards. Przemo itself was a kitchen sink:
it shipped every mod enabled, and most admins turned a large share off again. Building and
maintaining all 75 to the same standard would delay the board people actually need, and some
of them (moderator "spy" views, HTML in posts) work against the project's privacy and security
goals. There is no usage data from real boards yet.

## Decision
- Every package gets a priority (PACKAGES.md §2.11):
  - **A, must-have** (17): built by the project first, each with its importer slice.
  - **B, worth having** (about 40): built by the project after tier A, off by default.
  - **C, not built by the project** (about 15): dated, privacy-hostile, tied to dead services,
    or of unclear value. Left to third parties; their legacy data is reported, not imported.
- A new profile, **`essentials`** (core + tier A), is the default for `postmodem init` and for
  imports. `przemo` (core + A + B, Przemo's defaults) stays available. The earlier `modern`
  idea is folded into `essentials`.
- The extension points are built together with their first tier A users (M2), so each one
  is shaped by real code rather than designed ahead of it.
- The tiers are judgement calls and are revisited with data: the anonymised report bundle
  gains the values of Przemo's on/off feature switches, which show what real boards used.

## Consequences
- A board imported with defaults may have data for a tier B package that is switched off;
  the importer slice for that package still runs when the package is enabled later.
- Tier C legacy data (e.g. `topic_view`, HTML-enabled posts) will never be imported by the
  project. The import summary currently calls all Przemo data "imported with their packages
  later"; it learns the tiers in M2 so admins who need tier C data know before switching.
- Extension point #10 (alternate renderers), used only by `threaded-view`, is built last.
- "Everything can be turned off" still holds: every package, tier A included, can be disabled.
