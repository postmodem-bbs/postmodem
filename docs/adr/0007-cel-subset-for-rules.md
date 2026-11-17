# ADR 0007 — CEL subset for access and display rules

- Status: **accepted** · 2026-11-17 (after spike, see
  [tools/spikes/cel-rules/SPIKE.md](../../tools/spikes/cel-rules/SPIKE.md))

## Context
Tier-1 add-ons express permissions and conditions declaratively (collection
access, entity-field read/write, channel subscription, slot/page visibility).
The rules come from untrusted authors and have to:
1. evaluate per document (row-level checks on writes);
2. **compile to SQL/search filters** for `list` rules, so pagination and
   counts are correct and fast;
3. be impossible to use for code execution or denial of service;
4. give good errors at install time.

Options: a custom mini-language, or a subset of CEL (Common Expression
Language, Google; used by Kubernetes admission policies, Envoy, Firebase-like
rule systems). Side-by-side, CEL reads like JavaScript and a custom language
reads more like English. A custom language would also need its own spec,
safety limits and error handling, which CEL already has.

## Decision
A **CEL subset** (full spec: [PLATFORM-SERVICES.md §6.3](../PLATFORM-SERVICES.md)):

- **Parsing and evaluation:** [`@bufbuild/cel`](https://github.com/bufbuild/cel-es)
  (Apache-2.0), using only its public `parse()`, `plan()` and `unparse()`.
- **Type checking: ours.** The spike found that 0.6.2's checker is unexported
  and incomplete. Our subset checker (~170 lines in the spike) resolves names,
  fields, settings and functions against the add-on's schema, rejects
  mixed-type comparisons and disallowed constructs, and reports line:column
  with "did you mean" hints.
- **Pre-resolution: ours.** Every viewer-only sub-expression (`can`, `setting`,
  `pref`, `isMember`, `now`, `count`, `viewer.*`, `scope.*`) is evaluated once
  per request with CEL itself and replaced by a constant; both backends then
  see the same residual expression.
- **SQL compiler: ours**, for SQLite and Postgres, with protobuf default
  semantics (`COALESCE`), case-sensitive string functions, and `COLLATE "C"`.

## Spike evidence
- 0 mismatches between the evaluator, SQLite and Postgres over 7 rules ×
  3 viewers × 3000 edge-case documents.
- Parse + check ~155 µs at install; ~36 µs per request per rule
  (pre-resolve + SQL); ~2–3 µs per document evaluation.
- 73 KB gzip server-side; nothing ships to browsers.

## Consequences
- The external dependency is thin (parser + evaluator) and wrapped behind an
  internal `rules` module; replacing it touches two call sites.
- Two backends must agree. The spike's cross-check harness becomes a
  permanent test plus a grammar fuzzer in CI.
- Follow-ups from the spike: prove translatability at install time for all
  viewers; `count()` across collections; fuzzing.
