# ADR 0012 — Configurable permalinks, phpBB2-classic by default

- Status: accepted · 2026-11-17

## Context
Forum URLs are forever: they live in search engines, old posts, bookmarks and
other sites. Postmodem boards are often migrated from phpBB2/Przemo, whose URLs
look like `viewtopic.php?t=123`. Admins have different tastes (WordPress made
"permalink structure" a standard admin choice), and the choice may change
over a board's lifetime.

## Decision
The URL style is a **board setting** (`core.urls.style`) with three presets:

| Preset | Topic | Forum | User |
|---|---|---|---|
| **`classic`** *(default)* | `/viewtopic.php?t=123&start=30`, post: `/viewtopic.php?p=4567#p4567` | `/viewforum.php?f=7` | `/profile.php?mode=viewprofile&u=42` |
| `numbered` | `/t/123-my-new-pc-build?page=3` | `/f/7-hardware` | `/u/42-alucard` |
| `slug` | `/topic/my-new-pc-build?page=3` | `/forum/hardware` | `/user/alucard` |

- **Classic is byte-for-byte phpBB2**, including the `start=` offset
  pagination, so a migrated board keeps every URL without a single redirect.
- **Content is addressed by id internally.** SvelteKit's `reroute` hook maps
  every supported public shape to internal id-based routes, so all styles
  resolve at all times. Requests in a non-canonical style get a 301 to the
  canonical URL for the current setting, so switching styles never breaks a link.
- **Slugs** are generated from titles (transliterated, e.g. Polish `ł → l`),
  unique per kind, and kept in a `slug_history` table so renamed topics keep
  redirecting.
- Links are only ever built through one `urls` service (`urls.topic(t, {page})`)
  in the web layer; templates, emails, feeds and the federation module use it
  too. A lint rule forbids hand-written internal paths in Svelte components.
- Custom token patterns (WordPress `%postname%` style) are a possible later
  addition; the internal id-based routing already supports them.

## Implementation (M1 slice 7)
- Internal routes live under `/-/` (`/-/topic/[ref]`, `/-/forum/[ref]`,
  `/-/category/[ref]`, `/-/user/[ref]`, `/-/post/[ref]`). A ref is an id (`123`), a slug
  (`~my-topic`) or a classic category number (`@3`). `reroute` (src/hooks.ts) is a pure
  function of the URL, so it runs in the browser too and never touches the database: slugs
  are resolved by the page's `load`, which then checks the request against the canonical URL.
- Lookup order for a slug: the current slug, then `slug_history`. Nodes, topics and users
  get a new slug when renamed; the old one goes into the history.
- Categories: classic `index.php?c=N` uses the phpBB2 category number for imported categories
  (from `legacy_ids`), else the node id. When a new category's id equals an imported
  category's old number, its classic link falls back to the numbered form instead of
  pointing at the wrong category.
- Post locator: `viewtopic.php?p=ID` (classic) or `/p/ID` (numbered, slug), a 302 to the
  page holding the post, since that page changes when posts come and go. Links built where the
  page is known (permalinks inside a topic) point at the page directly.
- Imported topic slugs end in their id (`my-pc-123`) to stay unique without per-row checks;
  the numbered style drops that suffix (`/t/123-my-pc`).
- The style is read per request; servers re-read settings every 5 s, so
  `postmodem settings set core.urls.style slug` applies to a running board, all replicas
  included.
- Not implemented: the lint rule against hand-written internal paths.

## Consequences
- Imported boards keep their URLs with the default setting, so the "legacy
  redirects" work item in M1 largely disappears (old URLs simply are the URLs).
- `.php` paths are served by Node; that's harmless and purely cosmetic.
- Slug style needs a DB lookup, done in the page's `load` (see Implementation), not in
  `reroute`.
- Pagination differs per style (`start=` offset vs `page=`); the `urls` service
  converts both ways.
