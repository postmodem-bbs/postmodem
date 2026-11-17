# Spike: CEL subset for add-on rules (ADR 0007)

Throwaway code; the findings are what matter. Run it with:

```bash
cd tools/spikes/cel-rules && npm install && node src/crosscheck.ts
```

Node 24 (built-in TypeScript stripping and `node:sqlite`), `@bufbuild/cel` 0.6.2,
PGlite (real Postgres compiled to WASM), esbuild for size measurement.

## What was built (~540 lines)

| File | Purpose |
|---|---|
| `src/schema.ts` | Turns osbb field declarations into protobuf descriptors so CEL knows the shape of `viewer`, `doc`, `scope` |
| `src/rules.ts` | Our checker, pre-resolution of viewer-only parts, evaluator wrapper, SQL compiler (SQLite + Postgres) |
| `src/crosscheck.ts` | Diagnostics demo, a 3000-document cross-check, row/create rules, timings |

## Results

### 1. Correctness: evaluator vs SQLite vs Postgres

7 list rules × 3 viewers (guest, member, moderator) × 3000 generated documents
with deliberate edge cases: absent optional fields, timestamps exactly at
"now" ±1 ms, `%`/`_` in titles, mixed case, emoji, empty strings, integers
up to 2⁴⁰, empty and missing lists.

**0 mismatches** on all 21 combinations, on both databases.

Things that would have caused mismatches without explicit handling, all
handled in the compiler:

| Trap | Handling |
|---|---|
| CEL/protobuf reads an absent field as its default (`''`, `0`, `false`, epoch); SQL gives `NULL`, and `NOT NULL` is not `TRUE` | every field read is wrapped in `COALESCE(field, default)` |
| SQLite `LIKE` ignores ASCII case; CEL `startsWith` doesn't | `substr`/`instr` on SQLite, `starts_with`/`strpos` on Postgres |
| Postgres string ordering follows the locale collation; CEL uses code points | `COLLATE "C"` on string comparisons |
| `size()` counts code points | SQLite `length()` / Postgres `char_length()` (both code points; verified with emoji) |
| Timestamps compare as text | stored and passed as fixed-width UTC ISO 8601 with milliseconds |

### 2. Install-time diagnostics

All 12 bad rules are rejected with line:column and a readable message:

```
viewr.id == doc.author              → 1:1: unknown name 'viewr' (did you mean 'viewer'?); available here: viewer, scope, doc
!viewer.isGust                      → 1:8: viewer has no field 'isGust' (did you mean 'isGuest'?)
doc.author == 5                     → 1:12: cannot compare string with int (always false)
doc.priority >= setting('minPrio')  → 1:25: this add-on has no setting 'minPrio'
doc.groups.exists(g, isMember(g))   → 1:11: all(), exists(), exists_one(), map() and filter() are not allowed in rules
doc.title.matches('^A')             → 1:10: matches() can't be used in list rules (it can't be turned into a database filter)
has(doc.title)                      → 1:1: has() only works on optional fields; 'title' is always present
doc.title ==                        → 1:11: syntax error: found = but expecting end of input
```

A list rule that can't become SQL is rejected with a suggested rewrite:

```
age(doc) < setting('editWindow')  → subtraction (-) involving document fields can't become a database filter;
                                    rewrite it as a comparison against a constant (e.g. doc.created > now() - duration('5m'))
```

### 3. Pre-resolution works as designed

The advanced announcements rule reduces per viewer to exactly what the
design predicted:

```
guest:     doc.audience == "all" && doc.startsAt <= timestamp("…") && … && (!has(doc.forum) || doc.forum == "f1")
member:    (doc.audience == "all" || doc.audience == "members") && …
moderator: doc.startsAt <= timestamp("…") && …          ← the audience clause disappears
```

`count()` in create rules is resolved through the same SQL compiler, so a
user with 756 items gets `false` without evaluating anything else, and a
newcomer gets just `size(input.title) <= 80`.

### 4. Speed (laptop, Node 24, single thread)

| Step | When | Time |
|---|---|---|
| parse + check the advanced rule | install / upgrade | ~155 µs |
| pre-resolve viewer-only parts | once per request per rule | ~31 µs |
| compile residual to SQL | once per request per rule | ~5 µs |
| evaluate one document (advanced rule) | per row-level check | ~3 µs |
| evaluate the edit-window rule | per row-level check | ~1.8 µs |

The planned budget was 0.5 ms per document; we're about 150× under it.

### 5. Size

Server-only module, minified: **294 KB raw / 73 KB gzip**: `@bufbuild/cel`
113 KB, `@bufbuild/protobuf` 104 KB, `@bufbuild/re2` 48 KB, our code 15 KB.
Irrelevant for the browser (rules never ship to clients) and small next to the
image budget.

## Findings that change the plan

1. **`@bufbuild/cel` 0.6.2 has no usable type checker.** `check()` exists in
   the package but isn't exported, and it fails on any call or field access
   ("Unsupported expression kind"). It looks like unreleased work in
   progress. We use only `parse()`, `plan()` and `unparse()`, which are
   public and worked flawlessly here.
2. **Our own checker is small**: about 170 lines for the whole subset, with
   better messages than a generic CEL checker would give ("did you mean",
   "always false", database-specific reasons). It walks the same syntax tree
   the SQL compiler needs anyway, so writing it costs little extra.
3. **The library dependency is therefore thin**: parser + evaluator. Replacing
   it later (with `@marcbachmann/cel-js` or our own parser) would touch two
   call sites.
4. **CEL quietly allows mixed-type equality** (`doc.author == 5` is just
   `false`). Our checker turns this into an error. A plain CEL setup would not.

## Not covered by the spike (follow-ups for the real implementation)

- Proving translatability **at install time** for all viewers, not just at
  request time. Approach: resolve once with a placeholder viewer per
  static-expression type, since only row-dependent parts reach the compiler.
- `count()` against a different collection (the spike counts in the same one).
- Fuzzing: random rule generation over the subset grammar, cross-checked
  the same way as here (the harness is the template).
- Durations stored in documents, doubles in comparisons with ints (rejected
  for now), `?:` producing non-boolean values inside comparisons.
