# ADR 0021 — Database-backed search provider v0

- Status: accepted · records the decision shipped in 0.1.0

## Context

Board search must work in solo and stack deployments, and its results must respect current
forum permissions and post visibility. Both supported databases provide full-text search.

## Decision

The core uses a search repository implemented with SQLite FTS5 and PostgreSQL full-text
search. Both fold indexed text and query terms and require every term to match, with
prefix matching. Index plain post text and omit quoted and hidden blocks. Maintain the
index on writes and moderation moves, and support rebuilding it from board data.

Apply readable-forum and visibility filters in the search query before returning results.
Search order and result limits are part of the board's search behavior.

## Consequences

Each deployment can search with its existing database. Both engines need integration
coverage to keep indexing and matching behavior aligned. Additional providers must
preserve the same visibility and permission guarantees.

## Optional Meilisearch provider

Issue #45 adds Meilisearch as an opt-in derived index. The built-in index remains available
when the external service is unavailable. A database queue records post and topic changes
in the transaction that commits them. The worker acknowledges changes after indexing tasks
succeed. The search route uses current forum access and the provider verifies the post,
topic, author and matching text against the database to exclude stale hits.

Meilisearch sorts by date and post ID, requires all query words, and treats the final word
as a prefix. The database engines use prefixes for every word.
