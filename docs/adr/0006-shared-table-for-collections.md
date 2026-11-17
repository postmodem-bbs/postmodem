# ADR 0006 — One shared table for add-on collections

- Status: accepted · 2026-11-17

## Context
Tier-1 add-ons store documents in collections (shoutbox messages, ads,
announcements, pages, nav links). The options were one shared JSON table for all
collections, or a generated SQL table per collection.

## Decision
A single table `ext_docs(addon, collection, scope, id, author, created, updated, state, data)`
with `data` as JSONB on Postgres and JSON on SQLite
([PLATFORM-SERVICES.md §6.6](../PLATFORM-SERVICES.md)):
- indexes declared in the manifest become expression indexes on
  `data->>'field'`, partial on `(addon, collection)`. On SQLite these are
  generated columns plus an index;
- one retention job handles all collections;
- per-add-on limits (defaults: 100k docs, 64 KB per doc, 500 MB, 20 collections,
  5 indexes per collection).

## Consequences
- Installing and upgrading tier-1 add-ons needs no DDL beyond index creation,
  which keeps hot enable/disable possible.
- One code path for both SQL dialects, privacy export/erase, moderation and backups.
- Not suited to heavy relational workloads. Hitting the limits is the signal
  to graduate the add-on to a tier-2 module with its own tables
  (`postmodem ext graduate`).
