# ADR 0014 — Post markup: one BBCode dialect, class-based output, holes for readers

- Status: accepted · 2026-11-17 (M1 slice 2)

## Context
Imported boards carry phpBB2/Przemo storage: text HTML-escaped by `prepare_message`
(`&` → `&amp;` except numeric entities, `<` `>` `"` → entities, Przemo restoring a list
of named symbols), and every matched BBCode tag rewritten with the post's uid
(`[b:uid]`, `[code:1:uid]`, `[quote:uid="name"]`, `[/list:u:uid]` …). Postmodem's strict
CSP forbids inline `style` attributes, and some tags (`[you]`, `[hide]`) depend on the reader.

## Decision
- **One dialect** (`bbcode-phpbb2`: phpBB2's tags plus Przemo's `center fade glow shadow
  scroll hide you`, no uids, no HTML escaping). Legacy storage is converted **once, at
  import**, by `fromPhpbb2Storage(text, uid)`: only the post's own uid is stripped (tags with
  another uid stay literal, as phpBB2 showed them) and entities are decoded exactly once.
  The M2 editor writes the same dialect.
- **Safe by construction:** the renderer emits only an allow-list of elements and
  attributes; URLs are limited to http(s)/ftp (mailto for `[email]`); broken markup
  degrades to the text the author typed. A 3000-input fuzz test guards this.
- **Classes, not styles:** colours snap to phpBB2's palette and render as `bb-color-*`
  classes whose values are theme tokens (`--pm-bb-*`), contrast-tested at 4.5:1 in light
  and dark; sizes map to five steps; effects (`fade`, `scroll`) stop under reduced motion.
- **Holes:** `[you]` and `[hide]` render as markers in the cached HTML and are filled per
  request. M2b adds the `hide-until-reply` package. The renderer stores sanitized private
  fragments alongside the public HTML in the server-side cache. Only the topic view
  resolves them with reader facts. The package, when enabled, checks for a public reply
  or `hide.bypass` in the topic's forum.
- **Caching:** HTML is stored on the post with `RENDER_VERSION`; bumping it re-renders
  lazily on read.
- **External images:** `[img]` hotlinks are part of every legacy board, so the CSP allows
  `img-src https:`; images load with `referrerpolicy="no-referrer"` and lazily. An image
  proxy (reader privacy, no third-party requests) is a later option.

## Consequences
- The importer must pass each post's `bbcode_uid` to `fromPhpbb2Storage` (slice 6).
- Themes must supply `bbColors` for both variants; the theme test enforces contrast.
- Readers' IPs are visible to third-party image hosts until the proxy exists; noted in the
  privacy documentation when that's written.
