# ADR 0004 — Core scope is vanilla phpBB2; Przemo ships as packages

- Status: accepted · 2026-11-17

## Context
To find out what the architecture and the Docker stack really need, every
feature Przemo added over vanilla phpBB 2.0.x is moved out of the core. The
authoritative list of those additions is Przemo's own uninstaller
(`admin/admin_uninstall.php`: 24 tables, ~110 columns, ~290 config keys).

## Decision
- The core implements vanilla phpBB2 behaviour, modernised. The only
  exceptions (node tree, audit log, roles, typed settings, the topic-type
  registry) are listed in [PACKAGES.md §0.2](../PACKAGES.md).
- Every Przemo addition is an add-on, a module or a platform-service
  capability. Three platform services (entity fields, counters, preferences)
  and twelve core extension points come directly out of this split.
- Packages never alter core tables. They use entity fields or side tables
  keyed by the core id.
- Each package carries its own importer slice for its share of the legacy data.
- Distribution profiles (`vanilla`, `przemo`, `modern`) install sets of packages;
  `przemo` is the default.

## Consequences
- About 75 packages. Most are small, but each must be versioned, tested
  in the package matrix, and switchable off.
- Rendered-post caching has to allow per-viewer variation (PACKAGES.md §3, point 4).
- Valkey becomes recommended for multi-replica stacks; ClamAV becomes an
  opt-in profile; libvips ships in the image.
