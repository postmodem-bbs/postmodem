# Postmodem — platform services (tier-1 add-on runtime)

Status: **draft** · 2026-11-17 · builds on [DESIGN.md §6](DESIGN.md),
[EXTENSION-POINTS.md](EXTENSION-POINTS.md), [PACKAGES.md](PACKAGES.md)

> **v0 implemented (M2b slice 10, 2026-11-19)** for first-party packages: preferences (§4),
> entity fields (§5), collections (§6), channels (§7) and counters (§8), declared in a
> package's TypeScript definition (`@postmodem/core` `platform/`). Rules are TypeScript
> functions for now; the JSON manifest, CEL rules, slots with templates, islands and the
> client API arrive with the tier-1 SDK (M4). Not yet: field forms and indexes, collection
> expression indexes, presence, WebSocket, counters' `beacon`/`redirect` sources and unique
> counts.

Platform services are what a tier-1 add-on can do **without server code**.
Each one is a core feature with a declarative surface (the manifest), a
server-side enforcement point, and a small client API. Tier-2 modules can use
them too, through the SDK.

Design target: every first-party tier-1 package in PACKAGES.md (about 30,
including the shoutbox, stats widgets, topic prefixes, ads, pages and display
preferences) can be built from this document alone.

---

## 0. Trust model (correction to ADR 0003)

ADR 0003 said tier-1 add-ons are "safe to install from untrusted sources".
That holds for **server-side** behaviour: every write goes through core-enforced
rules. It does **not** hold for client JavaScript. Script running on the
board's own origin can act as the logged-in reader (read CSRF tokens, call the
API, post as them), whatever the platform does. So tier 1 has **three
execution modes**:

| Mode | What the add-on may ship | Where its JS runs | Install policy |
|---|---|---|---|
| **Declarative** | manifest, templates, CSS, assets, locales; **no JS** | — | Safe from any source |
| **Island** | + JS | In a **sandboxed iframe served by the board itself** with an opaque (`null`) origin: `sandbox="allow-scripts"` on the frame, plus a `CSP: sandbox …; connect-src 'none'` header on the response ([ADR 0008](adr/0008-same-host-opaque-origin-islands.md)). It talks to the page only over a `postMessage` bridge that exposes the client API (§10) with the reader's capabilities | Safe from any source |
| **Inline** | + JS as custom elements in the page | On the board origin | **Trusted only**: first-party, or an admin explicitly marks the add-on trusted (a clear warning, logged in the audit log) |

Islands cost a little (an iframe, auto-resized through the bridge) but give
strong isolation without any JS sandboxing tricks, and need **no extra port,
hostname or configuration**. Verified in headless Chrome: the island can't
read cookies, `localStorage` or the board page, can't navigate the board, and
can't make network requests. Island HTML is static and never personalised;
reader data only arrives through the bridge. First-party add-ons run inline;
community add-ons run as islands until an admin decides otherwise.

CSS from untrusted add-ons is also processed (§9.3), because CSS alone can
exfiltrate data (attribute selectors + `url()`).

---

## 1. The manifest

One file, `postmodem.extension.json`, validated against a published JSON Schema
(editor autocompletion out of the box):

```jsonc
{
  "$schema": "https://schemas.postmodem.app/extension/1.json",
  "id": "shoutbox",
  "tier": 1,
  "mode": "inline",                    // declarative | island | inline
  "version": "1.0.0",
  "engine": "^1.0.0",
  "name": { "en": "Shoutbox", "pl": "Shoutbox" },
  "capabilities": { … },               // §2
  "settings": { … },                   // §3
  "preferences": { … },                // §4
  "fields": { … },                     // §5  entity fields
  "collections": { … },                // §6
  "channels": { … },                   // §7
  "counters": { … },                   // §8
  "slots": { … },                      // §9
  "pages": { … },                      // §9.4
  "markup": { … },                     // §11
  "webhooks": { … },                   // §12
  "personalData": { … },               // §13
  "dependencies": { "optional": ["helpful"] }
}
```

Every section is optional. Unknown keys are an error (no silent typos).

### 1.1 Shared value types

All schemas (settings, preferences, fields, collection documents) use one
type vocabulary, so one form renderer, one validator and one importer serve
everything:

`string` (`minLength`, `maxLength`, `pattern`, **`maxWordLength`**) · `text`
(multi-line) · `markup` (rendered through the core markup pipeline, with
`allow: { bbcode, smilies, links }`) · `int`/`number` (`min`, `max`) · `bool` ·
`enum` (`values`, i18n labels) · `date`/`datetime`/`duration` · `url`
(`schemes`) · `color` (**theme token reference** or contrast-checked value) ·
`user`/`topic`/`forum`/`group` (references) · `asset` (upload into the
add-on's asset store, image constraints) · `list<T>` · `secret` (settings only:
stored encrypted, never sent to clients or templates).

`maxWordLength` is there because Przemo's shoutbox had `word_lenght`
(long unbroken strings break layouts). Real legacy settings decide what goes
in the vocabulary.

---

## 2. Capabilities

```jsonc
"capabilities": {
  "shoutbox.read":     { "default": ["guest", "member"], "scope": "global" },
  "shoutbox.post":     { "default": ["member"] },
  "shoutbox.editOwn":  { "default": [] },
  "shoutbox.moderate": { "default": ["moderator", "admin"], "dangerous": false }
}
```

- They become ordinary core capabilities: assignable to roles, scoped,
  shown in the permission simulator.
- **Per-user bans need no add-on code.** Przemo's `banned_user_id` /
  `banned_user_id_view` become a `never` grant of `shoutbox.post` /
  `shoutbox.read` to those users in the core role system.
- IDs are prefixed with the add-on id; the manifest can't declare capabilities
  outside its namespace.

## 3. Settings

```jsonc
"settings": {
  "visibleMessages": { "type": "int", "min": 5, "max": 200, "default": 30 },
  "retentionDays":   { "type": "int", "min": 0, "default": 30, "help": "0 = keep forever" },
  "maxLength":       { "type": "int", "min": 20, "max": 2000, "default": 500 },
  "maxWordLength":   { "type": "int", "min": 10, "default": 80 },
  "editWindow":      { "type": "duration", "default": "PT5M" },
  "allowMarkup":     { "type": "bool", "default": true }
}
```

- Scopes: `board` (default) or `node` (per forum, inherited down the tree).
- The ACP renders the form automatically; the add-on can group fields
  (`"groups"`) and supply help text.
- Settings changes are audit-logged and emitted as `settings.changed`.
- Settings may be referenced **inside other manifest declarations**
  (`"$setting": "maxLength"`) so limits are configured, not hard-coded.

## 4. Preferences

```jsonc
"preferences": {
  "collapsed": { "type": "bool", "default": false, "guest": "cookie" },
  "position":  { "type": "enum", "values": ["top", "bottom", "hidden"], "default": "top", "adminCanForce": true }
}
```

- Members: stored server-side. Guests: `"guest": "cookie" | "none"`. Only
  small scalar types are allowed in cookies (the total preference cookie is
  capped at 2 KB).
- Readable in templates (`prefs.position`), writable via the client API or a
  plain form post (works without JS).
- `display-preferences` uses this service to seed Przemo's ~25 `customize.php`
  toggles; a single "Display" page in the user CP lists all preferences from
  all add-ons, grouped by add-on.

## 5. Entity fields

```jsonc
"fields": {
  "topic.prefix": {
    "type": "enum", "valuesFrom": { "field": "forum.allowedPrefixes" },
    "write": "author || can('core.topic.edit')",
    "read": "public",
    "form": { "on": ["topic.create", "topic.edit"], "position": "beforeTitle" },
    "render": { "slot": "topic.titlePrefix", "template": "prefix.liquid" },
    "searchable": true, "sortable": false, "filterable": true
  },
  "forum.allowedPrefixes": {
    "type": "list<string>", "write": "can('core.acp.forums')", "read": "public",
    "form": { "on": ["acp.forum.edit"] }
  }
}
```

| Property | Meaning |
|---|---|
| target | `user`, `forum`, `topic`, `post`, `group` |
| `read` | `public` · `members` · `staff` · `self` · a rule expression (§6.3) |
| `write` | rule expression |
| `form` | which core forms show it and where (form slots) |
| `render` | slot + template, or "decorate only" (value appears in view models) |
| `requiredAtRegistration` | user fields only (Przemo's `require_*`) |
| `searchable` / `filterable` / `sortable` | wires into search (EP-11) and listings (EP-2); filterable/sortable fields get DB indexes |
| `personal` | marks personal data, so privacy export/erase is automatic |

**Storage:** one typed side table per target, e.g.
`field_values_topic(entity_id, field_id, v_text, v_int, v_num, v_bool, v_date, v_json)`,
primary key `(entity_id, field_id)`. Partial indexes on
`(field_id, v_*)` are created only for fields declared sortable/filterable.
View models load all fields for a page's entities in one query per target.

**Admin-defined fields** (`custom-fields`) are entity fields owned by the
pseudo add-on `custom`, created in the ACP. Same storage, same renderer.

**Type changes** on upgrade are declared migrations (`"migrate": { "from": "string", "via": "parseInt" }`)
run as a background job. Uninstall keeps values for a grace period (§14).

## 6. Collections

The engine behind the shoutbox, ads, announcements, pages and nav links.

### 6.1 Declaration

```jsonc
"collections": {
  "messages": {
    "scope": "board",                                  // board | node | user
    "schema": {
      "body": { "type": "markup", "maxLength": { "$setting": "maxLength" },
                "maxWordLength": { "$setting": "maxWordLength" },
                "allow": { "bbcode": { "$setting": "allowMarkup" }, "smilies": true, "links": true } }
    },
    "rules": {
      "list":   "can('shoutbox.read')",
      "create": "can('shoutbox.post')",
      "update": "can('shoutbox.moderate') || (doc.author == viewer.id && can('shoutbox.editOwn') && age(doc) < setting('editWindow'))",
      "delete": "can('shoutbox.moderate') || (doc.author == viewer.id && can('shoutbox.editOwn'))"
    },
    "indexes": [["_created"]],
    "order": "-_created",
    "retention": { "maxAge": { "$setting": "retentionDays", "unit": "days" }, "maxDocs": 5000 },
    "rateLimit": { "create": "1/5s per viewer, 30/min per ip" },
    "moderatable": true,
    "broadcast": "live",
    "personal": ["body"]
  }
}
```

### 6.2 System fields

Every document has `_id` (ULID), `_author` (user or guest session),
`_created`, `_updated`, `_scope` (node/user id for scoped collections) and
`_state` (`visible` | `hidden` | `deleted`). Documents are never addressed by
row numbers, and authors are always set by the server.

### 6.3 Rule language: a CEL subset

Decided in [ADR 0007](adr/0007-cel-subset-for-rules.md), validated by the
[spike](../tools/spikes/cel-rules/SPIKE.md). Rules (collections,
entity fields, channel subscriptions, slot `when`, page `when`, markup
`enabledFor`) are written in a **subset of CEL** (Common Expression Language,
as used by Kubernetes, Envoy and Firebase-style policies). The syntax is
standard CEL; Postmodem only restricts what's allowed and adds a few functions.

**Engine:** [`@bufbuild/cel`](https://github.com/bufbuild/cel-es) for parsing
and evaluation only. Type checking is **Postmodem's own** (the library's checker
is unexported and incomplete in 0.6.x). Postmodem also adds a **second backend**: a
compiler from the CEL syntax tree to the predicate AST (EXTENSION-POINTS §2.2),
so `list` rules become SQL `WHERE` clauses and search filters instead of
per-document checks. SQL compilation follows protobuf default semantics
(absent field = `''`/`0`/`false`/epoch via `COALESCE`), uses case-sensitive
string functions (no SQLite `LIKE`), and compares strings with `COLLATE "C"`
on Postgres, so results match the evaluator exactly.

**Environment** (declared to the type checker, so typos and type errors fail
at install time with a line/column message):

| Name | Type | Available in |
|---|---|---|
| `viewer` | `{ id: string, isGuest: bool, roles: list<string>, locale: string }` | all rules |
| `doc` | collection document: schema fields + system fields `author`, `created`, `updated`, `scope`, `state` (schema fields can't use these names) | collection `read/update/delete/list` |
| `input` | the incoming write, typed by the schema | collection `create/update`, field `write` |
| `entity` | the target entity's view (`topic`, `post`, `user`, …) | entity field rules |
| `scope` | the node/topic/user the collection or channel is scoped to | scoped rules |
| `can(cap)`, `can(cap, nodeId)` | `bool` | all |
| `setting(key)`, `pref(key)` | typed by the add-on's own schema | all |
| `now()` | `timestamp` | all |
| `age(doc)` | `duration` (= `now() - doc.created`) | collection rules |
| `isMember(groupId)` | `bool` | all |
| `count(collection, filterRule)` | `int`, indexed and capped at 1000 | `create` rules only (e.g. "max 3 open ads per user") |

Standard CEL operators and types are kept: `== != < <= > >= && || ! in`,
`?:`, string/int/double/bool, `timestamp`, `duration` (`duration('5m')`),
lists and maps, `has()`, `size()`, `startsWith/endsWith/contains`.

**Removed from the subset** (rejected by the checker):

- comprehension macros (`all`, `exists`, `exists_one`, `map`, `filter`) on
  anything but literal or small declared lists. They're unbounded on real data;
- `matches()` (regex) in `list` rules (they can't compile to SQL portably);
  allowed in row-level rules, where RE2 keeps it linear-time;
- protobuf message construction and `dyn`.

**Two-backend guarantee:** a `list` rule must compile to the predicate AST.
The compiler supports field comparisons, `in`, `&&`/`||`/`!`, `has()`,
`startsWith`, timestamp/duration arithmetic against `now()`, and calls to
`can`/`setting`/`pref`/`isMember`, which are **resolved to constants before
compilation** because they depend only on the viewer and the board, never on
the row. Anything else in a `list` rule is an install-time error that says
which sub-expression couldn't be translated. Every rule is also run against
both backends in the add-on's install-time self-test (generated sample docs),
so evaluation and SQL can't drift apart.

**Cost limits:** CEL's cost model plus Postmodem limits: max 1024 characters per rule,
max nesting depth 12, evaluation budget 0.5 ms per document (rules are
compiled once at install and cached).

**Examples**

```
can('shoutbox.read')
doc.author == viewer.id && age(doc) < setting('editWindow')     // editWindow is typed `duration` in settings
can('ads.manage') || (input.slot in ['index.top', 'footer'] && count('ads', 'doc.author == viewer.id') < 3)
!viewer.isGuest && entity.forum.id in setting('enabledForums')
```

### 6.4 Endpoints

| | JSON (client API) | No-JS form |
|---|---|---|
| list | `GET /x/shoutbox/c/messages?limit=30&after=…` | rendered by the slot template's data query (§9.2) |
| create | `POST /x/shoutbox/c/messages` | `POST /x/shoutbox/c/messages/form` → 303 back to `return_to` (same-origin only) |
| update / delete | `PATCH` / `DELETE …/:id` | `POST …/:id/form` with `_method` |

All writes: CSRF-protected, rate-limited, schema-validated, rules checked,
audit-logged when `moderatable`, and emitted as
`collection.<addon>.<name>.created|updated|deleted` events (EP-9).

### 6.5 Moderation integration

`moderatable: true` documents get the standard report button (if `reports`
is installed), appear in the moderation queue, can be hidden (`_state`), and
moderator actions land in the audit log. Add-ons don't build their own
moderation UI.

### 6.6 Storage

Shared table `ext_docs(addon, collection, scope, id, author, created, updated, state, data)`
with `data` as JSONB (Postgres) / JSON (SQLite). Declared `indexes` become
**expression indexes** on `data->>'field'` scoped by `(addon, collection)`
(SQLite: generated columns + index). Retention runs as one core job across
all collections.

Limits per add-on (defaults, adjustable by admin): 100k documents, 64 KB per
document, 500 MB total, 20 collections, 5 indexes per collection. A collection
that outgrows this is a signal to graduate to a tier-2 module with real tables.

## 7. Channels

```jsonc
"channels": {
  "live": {
    "scope": "board",                         // board | node | topic | user
    "subscribe": "can('shoutbox.read')",
    "sources": ["collection:messages"],       // automatic broadcast on create/update/delete
    "presence": { "enabled": true, "visibleTo": "members" }
  }
}
```

- **Publishing:** in v1 only from collection writes, public core events, and
  tier-2 code. **Clients cannot publish arbitrary messages** (that would be an
  unmoderated chat backdoor). Presence/typing signals are the exception: fixed
  shapes, server-rate-limited.
- **Payloads** are `{ event, id, doc? }`. The doc is included only if every
  subscriber may read it (same rule); otherwise just the id, and the client
  fetches it. This also keeps Postgres NOTIFY under its 8 KB limit.
- **Transport:** one multiplexed **SSE** stream per tab (`/x/stream`), with
  WebSocket as an optional upgrade. Resume with `Last-Event-ID` from a short
  replay buffer (default 2 min). If the stream drops, the client falls back to
  polling at the interval Przemo's shoutbox used (`shout_refresh`), so even
  hostile proxies work.
- **Backends:** in-process (solo) · Postgres LISTEN/NOTIFY (stack default) ·
  Valkey pub/sub (`scale` profile). Same semantics, chosen by
  `POSTMODEM_REALTIME_URL`.
- **Islands** receive channel messages through the bridge; they never open
  their own connection.
- Limits: 20 channels per add-on, 10 subscriptions per tab, payload ≤ 4 KB.

## 8. Counters

```jsonc
"counters": {
  "impressions": { "key": "doc", "periods": ["total", "day"], "source": "beacon", "dedupe": "session:1h" },
  "clicks":      { "key": "doc", "periods": ["total", "day"], "source": "redirect" }
}
```

- `source`: `beacon` (client `POST /x/<addon>/n/<counter>`, rate-limited,
  approximate), `redirect` (count, then 302 to a URL stored in the doc:
  exact, works without JS), or `event` (incremented server-side when a core
  event fires, e.g. per topic view).
- Unique counting (`"unique": "viewer"`) uses HyperLogLog on Valkey or an
  exact daily set table on DB backends.
- Flushed to `ext_counters(addon, counter, key, period, bucket, value)` every
  10 s (configurable). Readable in templates and via the client API.
  **Documented as approximate**: a crash loses at most one flush interval.
- Core uses the same service for vanilla topic views; tier-2 packages
  (visitors, topic-viewers, activity-stats) use it through the SDK with
  extra options (per-user keys, retention).

## 9. UI: slots, templates, pages, assets

### 9.1 Slots

A **versioned slot catalog** (`slots@1`) is part of the SDK: `head`,
`header.after`, `nav.items`, `index.top`, `index.sidebar`, `index.bottom`,
`forum.top`, `topicList.row.afterTitle`, `topic.titlePrefix`,
`topic.post.authorCard`, `topic.post.afterBody`, `topic.post.actions`,
`editor.toolbar`, `profile.tabs`, `ucp.sections`, `acp.nav`, `footer`… Each slot
documents its data context and layout constraints (inline vs block, max width).
Themes may hide or move slots but must render them in the catalog's order
semantics.

```jsonc
"slots": {
  "index.top": {
    "template": "box.liquid",
    "element": "pm-shoutbox",                 // inline/island JS enhancement (optional)
    "data": {                                   // named server-side queries run before render
      "messages": { "collection": "messages", "limit": { "$setting": "visibleMessages" } }
    },
    "when": "can('shoutbox.read') && pref('position') == 'top'"
  }
}
```

### 9.2 Templates

- **LiquidJS in strict mode** (resolves DESIGN §11 open question 1):
  familiar, logic-light, no arbitrary code, a mature sandbox. Autoescaping is on;
  `| raw` is unavailable to tier 1.
- Context: `viewer` (safe subset: id, name, isGuest, locale, roles labels),
  `settings`, `prefs`, `data` (declared queries only, so no N+1 from templates),
  `slot` (the slot's view model, e.g. the post), `addon` (id, version, asset URLs).
- Filters/tags: `t` (i18n), `markup` (core render pipeline incl. holes),
  `date`, `relative`, `can`, `asset`, `user_link`, `avatar`, `counter`,
  `form` (emits a CSRF-protected form to a collection endpoint).
- Render budget: 10 ms per slot render; over-budget slots are skipped for that
  request and logged.
- Rendered on the server, so every add-on works without JS. The custom
  element (`element`) upgrades the server-rendered markup in place
  (progressive enhancement, not client-side rendering from scratch).

### 9.3 CSS & assets

- `public/` files are served from `/x/<addon>/a/<hash>/…`, immutable and cached.
- Add-on CSS is processed at install: wrapped in `@layer addons.<id>`, scoped
  with `@scope ([data-addon="<id>"])` to the add-on's own slot roots, `url()`
  allowed only to the add-on's own assets, `@import` and external fonts removed.
  CSP `img-src`/`font-src`/`connect-src` back this up.
- Theme tokens (`var(--pm-…)`) are the expected way to style; per-theme
  overrides go in `themes/<theme>/` inside the add-on.

### 9.4 Pages

```jsonc
"pages": {
  "faq": { "path": "/faq", "template": "faq.liquid", "title": { "t": "pages.faq" },
           "data": { "entries": { "collection": "entries", "order": "position" } },
           "when": "true", "nav": { "slot": "nav.items", "position": 50 } }
}
```

Served under `/x/<addon>/…`; the admin can alias a page to a short root path
(`/faq`) if it doesn't collide. Pages use the active theme's layout.

## 10. Client API (inline and island)

```ts
const pm = await window.postmodemReady;            // inline; islands get the same API via the bridge
pm.viewer                                    // { id, name, isGuest, locale, can(cap) }
pm.collections('messages').list({ limit: 30 }) / .create({ body }) / .update(id, …) / .remove(id)
pm.channels('live').subscribe((msg) => …)    // returns unsubscribe
pm.prefs.get('collapsed') / .set('collapsed', true)
pm.counters('impressions').hit(docId)
pm.t('shoutbox.placeholder', { name })
pm.ui.toast(msg) / .confirm(msg) / .resize()  // resize is island-only
```

Every call goes through the same rules as the HTTP endpoints; the client API
is a convenience, not a separate trust path. Versioned with the SDK; islands
negotiate the API version on bridge handshake.

## 11. Declarative markup tags

```jsonc
"markup": {
  "tags": {
    "center": { "syntax": "bbcode", "content": "inline+block",
                "html": "<div class=\"bb-center\">{content}</div>" },
    "fade":   { "syntax": "bbcode", "content": "inline",
                "html": "<span class=\"bb-fade\">{content}</span>",
                "outside": "{content}" },
    "spoiler":{ "syntax": "bbcode", "param": { "name": "title", "type": "string", "maxLength": 80, "optional": true },
                "html": "<details class=\"bb-spoiler\"><summary>{param|t:'spoiler.default'}</summary>{content}</details>" }
  },
  "toolbar": ["center", "fade", "spoiler"],
  "enabledFor": "can('bbcode-extras.use')"
}
```

- Output HTML may use only a small allow-list of elements and attributes
  (`div span details summary strong em code mark` + `class`/`data-*` limited
  to `bb-*`) and is sanitised again by the core.
- `outside` defines the plain fallback for feeds, email and federation
  (EXTENSION-POINTS §7.2). The default is `{content}`.
- Anything needing viewer context (e.g. `[hide]`) is tier 2 (render holes).

## 12. Outgoing webhooks

```jsonc
"webhooks": {
  "newTopic": { "events": ["topic.created"], "url": { "$setting": "webhookUrl" }, "format": "json" }
}
```

- Only **public events**; payloads exclude personal data unless the add-on
  declares it in `personalData` and the admin approves it.
- Signed (`X-Postmodem-Signature: HMAC-SHA256`), retried with backoff from the job
  queue, and shown in an ACP delivery log.
- **SSRF protection:** resolved addresses in private, loopback, link-local and
  metadata ranges are refused unless the admin allow-lists them explicitly
  (for homelab setups). Redirects are not followed.

## 13. Personal data

```jsonc
"personalData": { "purpose": { "en": "Shoutbox messages you post" }, "retentionDays": { "$setting": "retentionDays" } }
```

Collections and entity fields marked `personal` are exported and erased
automatically by the core privacy service (EXTENSION-POINTS §11). Tier-1
add-ons can't access IP or user agent at all.

## 14. Lifecycle

| Action | Effect |
|---|---|
| **Install** | Manifest + CSS processing + signature/integrity check; declarations registered; nothing visible until enabled |
| **Enable** | Slots, pages, endpoints and channels go live; capabilities get their default grants |
| **Disable** | Everything stops rendering; data kept; endpoints return 404 |
| **Upgrade** | New manifest diffed against the old: additive changes apply directly; renames/removals need declared `migrations`; a dry-run report is shown before applying |
| **Uninstall** | Data kept for a grace period (default 30 days) with "export" and "purge now" buttons; then purged by a job |
| **Graduate** | `postmodem ext graduate` scaffolds a tier-2 module with the same id; collections/fields stay valid and can be migrated to real tables later |

Tier-1 changes take effect **without a restart** (registries for tier-1
declarations are hot-swappable; tier-2 remains restart-to-apply, see
EXTENSION-POINTS §17.4).

## 15. Backends: solo vs stack

| Service | Solo | Stack (default) | Stack + `scale` |
|---|---|---|---|
| Settings, preferences, fields, collections | SQLite | Postgres | Postgres (+ Valkey read cache) |
| Channels | in-process | Postgres LISTEN/NOTIFY | Valkey pub/sub |
| Counters | in-memory buffer → SQLite | in-memory buffer per replica → Postgres | Valkey → Postgres |
| Rate limits | in-memory | Postgres (sliding window table) | Valkey |
| Islands | same host and port, opaque origin | same | same |

Islands need no infrastructure of their own (ADR 0008).

## 16. Worked example: Przemo's shoutbox, all 25 settings

| Przemo `shoutbox_config` | Postmodem |
|---|---|
| `shoutbox_on` | add-on enabled |
| `allow_guest_view`, `allow_users_view` | `shoutbox.read` default grants |
| `allow_guest`, `allow_users` | `shoutbox.post` default grants |
| `allow_edit`, `allow_delete` (own) | `shoutbox.editOwn` + rules |
| `allow_edit_all`, `allow_delete_all` | `shoutbox.editOwn` granted to `member` |
| `allow_edit_m`, `allow_delete_m` | `shoutbox.moderate` |
| `allow_bbcode`, `allow_smilies`, `make_links`, `links_names` | `markup` field `allow` options via settings |
| `count_msg` | setting `visibleMessages` |
| `delete_days` | collection retention via `retentionDays` |
| `text_lenght`, `word_lenght` | `maxLength`, `maxWordLength` |
| `date_format`, `date_on` | locale-aware `relative`/`date` filter; preference to hide timestamps |
| `shout_width`, `shout_height` | theme/CSS (responsive; height as a preference) |
| `shout_refresh` | SSE live updates; polling fallback interval |
| `banned_user_id`, `banned_user_id_view` | `never` grants of `shoutbox.post` / `shoutbox.read` per user |

Everything maps with no server code, which is what ADR 0003 promised.

## 17. Open questions

1. ~~Island origin~~: decided (ADR 0008). Same host, opaque origin, CSP
   `sandbox` + `connect-src 'none'`. Still to verify: Firefox and WebKit in CI.
2. ~~Rule language~~: decided (ADR 0007). CEL subset; `@bufbuild/cel` used only
   as parser and evaluator; checker, pre-resolution and SQL compiler are ours.
3. **Collections in search**: should `searchable` collection fields enter the
   board search (FAQ pages yes, shoutbox no)? Proposal: opt-in per collection.
4. **Add-on directory**: signing and review process for community add-ons
   (the minisign/cosign key per author, a curated index?). Deferred to M5.
