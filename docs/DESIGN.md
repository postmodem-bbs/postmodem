# Postmodem — a modern bulletin board in the Przemo tradition

Status: **draft for discussion** · 2026-11-17

---

## 1. Why this exists

phpBB2 "modified by Przemo" was the forum package of choice for a generation of
Polish (and not only Polish) communities: upload to any PHP host, run the
installer, and you had a fully loaded board with dozens of mods pre-integrated
and switchable from the admin panel. Its selling points, in Przemo's own
readme, were *maximum functionality while keeping the look and handling simple*,
*everything extra can be turned off in the ACP*, a self-checking installer, and
an updater/uninstaller.

The goal of Postmodem is to keep that spirit — **batteries included, every battery
removable, trivially self-hostable** — on a foundation that is secure,
accessible and extensible by design rather than by patching core files.

## 2. What the legacy code actually is (survey)

`old_przemo_phpBB/`: ~920 files, ~103k lines of PHP 4/5, MySQL only, ISO-8859-2,
subSilver template + eXtreme Styles (XS) template engine, English + Polish.

### 2.1 Feature inventory

| Area | Legacy implementation | Notes |
|---|---|---|
| Structure | `categories`, `forums`, sub-forums (`functions_hierarchy.php`), forum pruning | Two-level category/forum model plus nested sub-forums bolted on |
| Content | `topics`, `posts` + `posts_text`, polls (`vote_*`), post icons, topic colours, topic preview, post expiry (`expire`) | Post body split from metadata for MySQL 3 performance |
| Edit history | `posts_text_history`, `post_history.php` | Przemo highlight: full revision history |
| Reading state | `read_history`, `topic_view` ("who viewed this topic"), `topics_watch`, `topics_ignore`, `ignores` (users) | Server-side unread tracking |
| Users | registration w/ anti-bot (`anti_robotic_reg`), activation, COPPA, custom profile fields, gender, avatars (gallery/remote/upload), profile photos, signature images, custom name colours, custom ranks | Very long per-field config list (`cicq`, `cgg`, `cmsn`, …) |
| Groups & ranks | `groups`, `user_group`, `ranks`, group ranks | |
| Permissions | `auth_access` per forum × group with ~10 fixed bit-flags; "Junior Admin" (`jr_admin_users`) delegated admin | Fixed, non-extensible permission set |
| Moderation | modcp, warnings system (`users_warnings`, auto-ban on threshold), report post, ban tron (ban by user/IP/email), disallowed names, word censor, admin/mod action log (`logs`), "mod spy" (`topic_spy`), "helpful post" marking | |
| Messaging | Private messages with inbox/sent/save boxes, PM attachments, mass e-mail, "tell a friend", Gadu-Gadu notifications | GG = the era's IM; today → push/webhooks/Matrix/etc. |
| Attachments | Attachment Mod: extension groups, forbidden extensions, per-user/group quotas, thumbnails, download counter | |
| Live bits | Shoutbox, quick reply, "who's online" incl. record, last visitors | |
| Discovery | Full-text search (`search_wordlist`/`wordmatch`), `seeker.php` (user/post finder), statistics page with 15 pluggable stat modules | stat_modules is the closest thing to a plugin system |
| Monetisation | Banners, adverts (`advertisement`, `adv_person`) | |
| Presentation | XS template engine with in-browser editor, style import/export/clone, per-style rank/icon images, ~14 official styles | Templates can embed raw PHP (`xs_php`) |
| Ops | Web installer, `check_files.php` integrity check, `dbloader`, DB backup/restore, raw SQL console (`admin_sql.php`), updater from phpBB2 / older Przemo, uninstaller back to vanilla | |
| Config | ~300 keys in a flat `config` table (`board_config[...]`) | Everything toggleable — good intent, unstructured |

### 2.2 What not to carry forward

- **Security model of the era:** MD5 password hashes, ad-hoc input escaping,
  SQL built by string concatenation, PHP-in-templates, a web SQL console, FTP
  credentials stored in config.
- **"Mods" = core file patches.** Every feature is woven through
  `viewtopic.php`/`posting.php` with `if ($board_config['x'])` branches. This
  is why the package couldn't evolve once Przemo stopped.
- **Fixed permission bitmasks** and a flat untyped config table.
- **Table layouts, pixel widths, `onmouseover` overlib popups,** single
  charset, no semantic HTML.
- **Footer-integrity enforcement / phone-home update check** (anti-tamper code
  in the original). Postmodem is open source; attribution goes in the licence.

## 3. The landscape in 2026

- **phpBB 3.3.x** is the maintained line (3.3.19 as of Nov 2026); it gained a
  real extension system (event hooks, Twig templates, Symfony DI) in 3.1. A
  critical auth-bypass (CVE-2026-48611, fixed in 3.3.17) is a reminder of how
  heavy the legacy surface still is.
- **phpBB 4.0** has been in alpha since 2025, moving onto Symfony 6.4, Doctrine,
  and controllers instead of ACP/MCP/UCP modules. Still not production-ready.
- **Discourse** (Rails, Ember) dominates "modern forum", but is heavyweight to
  self-host and deliberately departs from the classic board layout (infinite
  scroll, flat categories).
- **Flarum** (PHP/Laravel) — extension-first core, minimal default UI.
- **NodeBB** (Node.js) — real-time, and since v4 **ActivityPub federation is a
  core feature**; Discourse offers it via a plugin.

**The gap Postmodem fills:** none of these feel like a *classic board* — category →
forum → paginated topic, ranks, signatures, a dense index page with stats and
"who's online" — while also being lightweight, accessible and federated.
That's our niche.

## 4. Design principles

1. **Classic board UX, modern internals.** Paginated threads with permalinks,
   forum index with last-post columns, signatures, ranks. No infinite scroll by
   default (it's a theme option).
2. **Works without JavaScript.** Server-rendered HTML; JS is progressive
   enhancement (live updates, rich editor, drafts). Good for accessibility,
   archivability, search engines and old devices.
3. **Core is small; features are modules.** Shoutbox, warnings, attachments,
   polls, stats, adverts… ship in the box as first-party modules using the
   *same* public API third parties get. "Everything can be turned off"
   becomes "every module can be disabled/uninstalled."
4. **Container-first.** One OCI image that runs solo (`docker run`, SQLite,
   local disk) or as a Docker Compose stack (Postgres, cache, search, S3). The
   modern equivalent of "FTP it to your host". The whole dev/CI/release process
   is built around that image — see [CONTAINERS.md](CONTAINERS.md).
5. **Accessibility is a requirement, not a theme.** WCAG 2.2 AA in core
   templates, enforced in CI.
6. **Own your data.** Full export, import from phpBB2/Przemo/phpBB3, ActivityPub
   federation optional.
7. **Secure by default.** Argon2id, CSRF everywhere, strict CSP, parameterised
   queries only, sandboxed untrusted extension code.

## 5. Architecture

```
                ┌──────────────────────────────────────────────┐
 Browser ──────►│  Web layer (SSR HTML + JSON API + WebSocket) │
 Fediverse ────►│  ActivityPub inbox/outbox  │  Admin UI       │
 API clients ──►│  REST/OpenAPI + webhooks   │                 │
                └──────────────┬───────────────────────────────┘
                               │ commands / queries
                ┌──────────────▼───────────────────────────────┐
                │ Core domain: forums, topics, posts, users,   │
                │ groups, permissions, settings, i18n, themes  │
                │        ▲ hooks/events    ▲ UI slots          │
                │  ┌─────┴──────┐  ┌───────┴────────┐          │
                │  │ Modules    │  │ Add-ons (tier 1)│         │
                │  │ (tier 2,   │  │ via platform    │         │
                │  │  SDK)      │  │ services        │         │
                │  └────────────┘  └─────────────────┘         │
                └──────────────┬───────────────────────────────┘
                               │
        DB (SQLite | Postgres) · Blob store (disk | S3) · Search (DB FTS | Meilisearch)
        Job queue (DB-backed) · Mail (SMTP) · Cache (in-proc | Redis/Valkey)
```

### 5.1 Stack (decided — [ADR 0002](adr/0002-typescript-with-decoupled-svelte.md))

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** end-to-end | Largest contributor pool; extensions and themes in one language |
| Runtime | Node.js 24 LTS (Bun-compatible) | |
| Web framework | **SvelteKit** (SSR, form actions), **as a replaceable web adapter only** | First-class progressive enhancement: forms work without JS |
| UI contract for extensions | **Web Components** (custom elements) | Framework-neutral; first-party Svelte compiles to them |
| DB | **Kysely** query builder, SQLite (default, `node:sqlite`) / PostgreSQL | One schema and one repository implementation for both dialects ([ADR 0013](adr/0013-kysely-for-portable-sql.md)) |
| Search | Built-in FTS (SQLite FTS5 / Postgres tsvector) behind a `SearchProvider` interface; Meilisearch adapter | |
| Jobs | DB-backed queue (no Redis required) | Mail digests, pruning, federation delivery, thumbnails |
| Realtime | SSE/WebSocket channel, optional | Live posts, shoutbox, presence |
| Rich text | Markdown + BBCode compatibility layer → sanitised AST → HTML | Import old posts losslessly |
| Packaging | Single multi-arch OCI image, roles by command; Compose stack in `deploy/` | See [CONTAINERS.md](CONTAINERS.md) |

Alternatives considered: Go + templ/htmx, PHP (Symfony/Laravel), and Elixir/Phoenix.
The reasoning is in ADR 0002.

#### Keeping Svelte at the edge

```
apps/web (SvelteKit) ──► packages/core (plain TS: domain, use cases, permissions)
        │                       ▲ ports
        │                packages/db, storage, mail, queue … (adapters)
        └──► packages/ui (Svelte → custom elements, theme tokens)
packages/sdk (framework-free) ◄── extensions (tier 1 & 2)
```

- Core and SDK never import Svelte, HTTP or a DB driver; dependency-cruiser
  enforces this in CI.
- Routes and form actions are thin: parse input → call a core use case → render.
- If SvelteKit ever has to go, only `apps/web`, `packages/ui` and theme template
  overrides are affected. Extensions and token/CSS themes are not.

#### Resource budget (soft)

Aim small, but don't contort the design to hit it. The target is a 1 vCPU VPS;
a Raspberry Pi 4/5 is a "should still run" exercise, not a constraint.

| Mode | Target | CI alarm |
|---|---|---|
| Solo, idle | ≤ 200 MB RSS | > 400 MB |
| Solo, 50 concurrent readers | p95 page < 150 ms on 1 vCPU | > 400 ms |
| Image size (compressed) | < 150 MB | > 250 MB |
| Cold start to `/readyz` | < 3 s | > 10 s |

Every page works without client JS, so the default JS payload is
enhancement-only: aim for under 50 KB gzip on topic pages.

### 5.2 Domain model (core)

- **Federation-ready, not federated** ([ADR 0009](adr/0009-federation-optional-module.md)):
  permanent never-reused URLs for every user/forum/topic/post (slugs separate
  from IDs); authors may be remote (`origin`, no login, `remote` role);
  sanitised remote HTML is a markup source; unregistered visibility states
  fail closed. The protocol itself is the optional `federation` module.
- **Node tree** instead of category/forum/subforum: a forum is a node with a
  `kind` (`category`, `forum`, `link`), arbitrary nesting via materialised
  path. Solves Przemo's sub-forum hack natively.
- **Topic → Post**, post body stored as source + rendered cache. Edit history
  is the `revisions` module; core only emits `post.beforeUpdate` with the old
  body ([PACKAGES.md](PACKAGES.md)).
- **Core scope = vanilla phpBB2**, modernised. Everything Przemo added is a
  package; the few exceptions are listed in [PACKAGES.md §0.2](PACKAGES.md).
  Packages never add columns to core tables: they use entity fields or
  side tables keyed by the core id.
- **Users, Groups, Memberships.** Ranks become a module that reads post count
  and group membership.
- **Read state**: per-user per-topic "last read post id" + per-forum
  "mark-all-read" watermark (bounded storage, unlike `read_history`).
- **Settings**: typed, namespaced, schema-validated (`core.posting.floodInterval:
  duration`), with defaults declared by the module that owns them. Replaces the
  300-key flat config.
- **Preferences**: the per-user counterpart of settings (successor of
  Przemo's `customize.php`). Core, modules, add-ons and themes declare typed
  preferences with defaults; admins can force a value. Stored server-side for
  members and in a cookie for guests. See [PARITY.md §9](PARITY.md).
- **Post merge & expiry**: a consecutive post by the same author within a
  configurable window is merged into the previous one (with a revision and a
  visible separator). Posts and topics can carry an `expiresAt` that a
  scheduled job acts on.
- **Topic timeline events**: lock/unlock/move/expire/merge actions are stored as
  events and rendered inline in the topic (Przemo's "show who locked/moved").

### 5.3 Permissions

Role-based with **capabilities registered by modules**:

- A *capability* is a string like `topic.create`, `post.edit.own`,
  `attachments.upload`, `shoutbox.post`. Modules declare their own.
- A *role* is a named set of capability grants (`Allow` / `Deny` / `Never`).
- Roles are assigned to **(group | user) × (scope: global | node subtree)**.
- Resolution ([ADR 0015](adr/0015-permission-resolution.md)): `Never` anywhere is
  absolute; otherwise the nearest scope that mentions the capability decides, the most
  specific subject (user > group > registered/guests > everyone) wins there, deny beats
  allow at equal specificity, and unset means no.
- "Junior Admin" = a role with a subset of `admin.*` capabilities. No special
  table.
- A permissions **simulator** in the ACP ("what can user X do in forum Y, and
  why?") — the thing every phpBB admin has wished for.

## 6. Extensibility — two tiers, one platform

See [ADR 0003](adr/0003-two-tier-extensions.md). Someone who wants a niche
feature should be able to make it in an evening with HTML and a bit of JS.
Someone writing a big mod should get a full, typed SDK. Both tiers use the same
package format, the same capability system and the same admin experience.

### 6.1 The tiers

| | **Add-on** (tier 1) | **Module** (tier 2) |
|---|---|---|
| Typical author | Board admin or hobbyist who knows HTML/CSS/JS | Developer |
| Made of | `postmodem.extension.json` + server templates + JS/CSS, **no build step** | TypeScript package built against `@postmodem/sdk` |
| Server code | None. Server behaviour comes from **platform services** (§6.2) declared in the manifest | Full: hooks, filters, routes, jobs, migrations, providers |
| UI | Server-rendered templates in a safe logic-less language (LiquidJS-style), enhanced by Web Components | Anything: Svelte compiled to custom elements, Lit, vanilla JS; plus server-rendered slot content |
| Without JS | Works: templates render on the server, and forms post to the collection endpoints | Works if the author follows the SDK conventions |
| Data | Platform collections (JSON documents, schema-validated) | Own SQL tables via migrations (namespaced `ext_<id>_*`), or collections |
| Trust | Server side always sandboxed by capability checks and rate limits. Client JS: **declarative** (no JS) and **island** (sandboxed iframe) are safe from any source; **inline** needs trust ([PLATFORM-SERVICES.md §0](PLATFORM-SERVICES.md)) | Trusted only; admin acknowledges at install. WASM sandbox later (phase 5) |
| Editing | Can be created/edited in the ACP's built-in editor (the safe successor of the XS template editor) | Developed locally with `postmodem ext dev`, shipped as a bundle |
| Graduation | `postmodem ext graduate` scaffolds a module with the same ID, capabilities and settings. An SDK helper moves collection data into SQL tables | — |

### 6.2 Platform services (available to both tiers)

> Full specification (manifest, value types, rule language, endpoints,
> storage, limits, lifecycle, shoutbox worked example) is in
> [PLATFORM-SERVICES.md](PLATFORM-SERVICES.md).

These are what make tier 1 powerful without letting it run server code:

- **Collections**: per-extension document stores. Declared with a JSON Schema
  and **access rules** that reference capabilities and ownership (e.g.
  `create: shoutbox.post`, `delete: owner || shoutbox.moderate`). Exposed as
  REST endpoints plus form-action endpoints (so they also work without JS), with
  pagination, simple filters, retention ("keep last N" / "expire after"), and
  per-user rate limits.
- **Channels**: realtime pub/sub over SSE/WebSocket, scoped to the extension.
  Writes to a collection can broadcast automatically. Presence is optional.
- **Entity fields**: typed extra fields on `user`, `forum`, `topic`, `post`,
  `group`, with validation, visibility, form placement, render slot and
  `searchable`. Stored in side tables. Admin-defined custom profile fields use
  the same mechanism.
- **Counters**: write-behind counters and per-period unique sets (views,
  hits, visits), buffered in memory or Valkey and flushed in batches.
- **Preferences**: per-user typed preferences (§5.2).
- **Settings**: a typed schema in the manifest becomes an ACP form automatically.
- **Capabilities**: declared in the manifest, assignable to roles like core
  ones (§5.3).
- **Slots**: named UI regions (`index.top`, `topic.post.afterBody`,
  `profile.tabs`, `acp.nav`…) that accept a server template, a custom element, or both.
- **Events (read-only)**: the client can subscribe to public core events
  (`post.created`…). The manifest can declare **outgoing webhooks** for
  server-side integrations, so a tier-1 add-on can still work with outside
  services.
- **Markup**: declarative custom BBCode/Markdown tags (pattern → template),
  sanitised by core.
- **i18n**: Fluent message files per locale.

### 6.3 Module extension points (tier 2 only)

> The full SDK v1 contract (command pipeline, visibility states, policy,
> rendering holes, events, registries, privacy, importer slices) is in
> [EXTENSION-POINTS.md](EXTENSION-POINTS.md). The list below is the short version.

- **Events** (after the fact, async): `post.created`, `user.registered`, `topic.moved`…
- **Filters** (synchronous, can transform or veto): `post.beforeCreate`,
  `content.render`, `search.index`, `user.validateRegistration`.
- **Routes** & API endpoints under the extension's namespace.
- **Jobs** & schedules on the core queue.
- **Providers**: `SearchProvider`, `StorageProvider`, `CaptchaProvider`,
  `AuthProvider` (OIDC, passkeys), `Notifier` (email, web push, Matrix, Discord
  webhook… the spiritual successor of Gadu-Gadu notifications), `Importer`.
- **Markup parser plugins** with full AST access.

The SDK is framework-free TypeScript. UI contributions are Web Components, so
modules don't break when Svelte releases a new major version ([ADR 0002](adr/0002-typescript-with-decoupled-svelte.md)).

### 6.4 Package format

```
postmodem-ext-shoutbox/
  postmodem.extension.json   # id, version, tier, engine range, capabilities, settings schema,
                        # collections, channels, slots, webhooks
  templates/*.liquid    # server-rendered slot content (both tiers)
  public/*.js|*.css     # custom elements and styles (both tiers)
  locales/{en,pl}.ftl
  server/index.ts       # tier 2 only: register(ctx)
  migrations/           # tier 2 only
  themes/<theme>/       # optional per-theme template/CSS overrides
```

Distributed as a signed `.pmext` bundle (a zip). A tier-1 add-on is literally
the directory zipped.

### 6.5 Dogfooding: the shoutbox as a tier-1 add-on

The shoutbox isn't core: it's an optional feature with its own design. It
ships as a **first-party tier-1 add-on**, which makes it the acceptance test for
the platform services:

- collection `messages` (schema: text ≤ 255 chars; retention: last 500; rate limit 1/5 s)
- channel `live`, broadcast on create/delete
- capabilities `shoutbox.read`, `shoutbox.post`, `shoutbox.moderate`
- slot `index.top`: a server template (renders the last 20 messages plus a plain
  `<form>` that works without JS) and a `<pm-shoutbox>` element that adds live updates
- settings: height, position, whether guests can read, BBCode on/off

If any Przemo shoutbox behaviour can't be built this way, the gap goes into the
platform, not into a special case for the shoutbox. Other first-party features
planned as tier 1 for the same reason: **topic colours, ads/banners, stats
widgets, staff page, "tell a friend"**.

## 7. Theming

Three layers, each optional:

1. **Design tokens** — CSS custom properties (colour, type scale, spacing,
   radius, density). A theme can be *just* a token file. Light/dark/high-contrast
   variants per theme; user can choose or follow OS.
2. **Stylesheet** — additional CSS scoped with `@layer` so core/extension/theme
   ordering is deterministic.
3. **Template overrides** — replace any Svelte component by path, with a
   versioned component contract so updates don't silently break themes. This
   is the only theme layer tied to Svelte; layers 1–2 are framework-free.

Shipped themes: **"Classic"** (an homage to subSilver/Przemo density, modern
markup), **"Modern"** (airy, card-based), **"Terminal"** (because why not).
ACP gets a live theme editor working on tokens only — no code editing in the
browser (replaces XS editor without the PHP-execution risk). Per-theme assets
(rank images, topic icons) stay supported, as in Przemo.

## 8. Accessibility & i18n

- Semantic landmarks, heading hierarchy, skip links, visible focus, all
  actions keyboard-reachable; live regions for realtime updates; reduced-motion
  respected; no information by colour alone (custom name colours get an
  accessible fallback).
- CI: axe-core + Playwright on every page template, per shipped theme.
- **i18n**: ICU/Fluent messages (proper Polish plural forms!), UTF-8 only,
  RTL-ready via logical CSS properties, per-user language and timezone,
  locale-aware dates. English and Polish ship in core.

## 9. Mapping legacy features to modules

> **Superseded in detail by [PACKAGES.md](PACKAGES.md)**, which splits
> everything Przemo added over vanilla phpBB2 into ~75 packages, each with its
> data and infrastructure needs, and derives the core extension points and
> Docker stack from them. The table below is kept as a coarse overview.

The full row-by-row audit of Przemo's ~200 settings and scripts is in
[PARITY.md](PARITY.md).

Rows marked **(add-on)** ship as first-party tier-1 add-ons (§6.5); the rest
are tier-2 modules or core. All are part of the default install and can be
disabled, which is how we keep feature parity with Przemo.

| Module (first-party) | Replaces | Modern additions |
|---|---|---|
| `core` | vanilla phpBB2: forums, topics, posts, users, groups, sessions, settings | Node tree, audit log, roles, typed settings |
| `auth` | login, sessions_keys, autologin | Argon2id, passkeys/WebAuthn, TOTP 2FA, OIDC providers, legacy-hash rehash-on-login |
| `editor` | posting, BBCode, smilies, quick reply | Markdown + BBCode, per-role tag toggles, `[hide]` until reply (enforced on the server), drafts autosave, preview, mentions, emoji + custom smilies |
| `polls` | vote_* | Multiple choice, close date, results visibility rules |
| `attachments` | Attachment Mod, quotas, extension groups | Content-type sniffing, image resize/strip EXIF, S3 storage |
| `profiles` | custom fields, avatars, photos, signatures, gender | Field builder, privacy per field, alt text for images |
| `ranks` | ranks, group ranks, custom ranks, name colours | |
| `messages` | privmsgs (inbox/sent/save) | Threaded conversations, multi-recipient, block lists |
| `notifications` | topic watch, email notify, GG notify | In-app, email digests, web push, webhook/Matrix notifiers |
| `moderation` | modcp, reports, logs, ban tron, disallow, word censor, mod spy, post expiry, delete/move notices | Queue-based report inbox, audit log, IP/ASN/email-domain bans, shadow-hold for new users; topic spy off by default and itself audit-logged |
| `warnings` | users_warnings | Point-based with decay and automated actions |
| `reactions` | "helpful post" | Configurable reaction set; "solved" marker |
| `read-tracking` | read_history, topic_view, ignore topics/users | Who-viewed as opt-in privacy feature |
| `shoutbox` **(add-on)** | shoutbox | Realtime via channels, moderation, rate limits; the reference tier-1 add-on |
| `stats` | statistics page + data API | Core aggregates; each of the 15 legacy stat_modules becomes an **(add-on)** widget |
| `topic-colours` **(add-on)** | topic_color, custom colour mod | |
| `staff` **(add-on)** | staff.php | |
| `share` **(add-on)** | tellafriend.php | Web Share API, copy-link |
| `announcements` **(add-on)** | board message | Scheduled, dismissible, per-page targeting |
| `pages` **(add-on)** | FAQ editor | FAQ, rules, privacy and other static pages in Markdown |
| `post-icons` **(add-on)** | post/topic icons | Per-theme icon sets |
| `fun-bbcode` **(add-on)** | [fade], [scroll], FrEaK & l33t | Reduced-motion aware |
| `presence` | who's online, records, last visitors | |
| `ads` **(add-on)** | adverts, banners | Slot-based; disabled by default |
| `search` | search_wordlist, seeker | FTS, filters by author/forum/date |
| `antispam` | anti_robotic_reg, flood control | Pluggable captcha (Altcha/Turnstile/hCaptcha), StopForumSpam, first-post moderation |
| `federation` | — | ActivityPub (FEP-1b12): forums as Groups; off by default, per-forum opt-in, fully reversible (ADR 0009) |
| `importer` | scripts/update.php | Import phpBB2, **Przemo 1.x**, phpBB3 (users, posts, PMs, attachments, permissions mapped to roles) |
| `ops` | check_files, db backup, dbloader | Health checks, scheduled backups, `postmodem doctor` CLI. *No* web SQL console |
| `syndication` | fetchposts | RSS/Atom/JSON Feed, embeddable widgets |

## 10. Delivery plan

1. **M0 — Skeleton** *(done 2026-11-17, not yet run in GitHub Actions):* repo,
   Dockerfile (dev + runtime targets), dev Compose stack with watch, Dev
   Container, CI that builds the image once and tests it (lint, typecheck,
   unit, e2e, axe), SQLite+Postgres migrations, typed settings, i18n plumbing,
   theme token pipeline. Licensing per ADR 0010: LICENSE files, SPDX headers,
   DCO and dependency-licence checks in CI, footer "Source" link.
   Toolchain as built: Node 24, pnpm 12, TypeScript 6.0 (SvelteKit and
   svelte-check don't support TypeScript 7 yet), SvelteKit 3 (config lives in
   `vite.config.ts`; `#lib` replaces `$lib`), Svelte 5, Vite 8, Vitest 5,
   Biome 2, Drizzle 0.45 (replaced by Kysely 0.29 in M1, ADR 0013), Playwright + axe-core.
2. **M1 — Readable board:** node tree, topics, posts, auth, registration,
   Classic theme, permissions engine. *Importer from Przemo* early so we can
   test against real-shaped data. Detailed plan: [milestones/M1.md](milestones/M1.md).
3. **M2 — Usable board:** editor, notifications, PMs, moderation, search,
   ACP (vanilla scope). **Platform services v0** (slots, settings schema,
   capabilities, entity fields, counters, preferences, collections, channels)
   and the 12 core extension points from PACKAGES.md §3, built because M3
   needs them. CI starts the *core-only* vs *przemo profile* matrix here.
4. **M3 — The Przemo packages** (PACKAGES.md §2), in dependency order:
   attachments, revisions, unread-tracking, login-security, reports, warnings
   first; then the rest. Each package ships with its importer slice. Any gap a
   package hits is fixed in the platform, never with a special case.
5. **M4 — Extension SDK v1** frozen and documented: tier-1 add-on guide plus
   ACP add-on editor, tier-2 module SDK, `postmodem ext graduate`, one third-party
   sample of each tier.
6. **M5 — Federation module** (phase 1: local forums as followable Groups;
   phase 2: following remote communities), **WASM sandbox, theme marketplace.**
   The federation-ready core items from §5.2 land in **M1**.

## 11. Open decisions

Decided: container-first delivery ([ADR 0001](adr/0001-container-first-delivery.md)),
TypeScript with Svelte kept at the edge ([ADR 0002](adr/0002-typescript-with-decoupled-svelte.md)),
two-tier extensions ([ADR 0003](adr/0003-two-tier-extensions.md)),
core = vanilla phpBB2 ([ADR 0004](adr/0004-core-is-vanilla-phpbb2.md)),
LiquidJS strict for add-on templates ([ADR 0005](adr/0005-liquidjs-for-addon-templates.md)),
one shared table for collections ([ADR 0006](adr/0006-shared-table-for-collections.md)),
CEL subset for rules ([ADR 0007](adr/0007-cel-subset-for-rules.md)),
add-on islands on the same host with an opaque origin ([ADR 0008](adr/0008-same-host-opaque-origin-islands.md)),
federation as an optional, reversible module with a federation-ready core ([ADR 0009](adr/0009-federation-optional-module.md)),
AGPL-3.0 core + Apache-2.0 SDK + DCO ([ADR 0010](adr/0010-agpl-core-apache-sdk.md)),
the name **Postmodem** and its identifiers ([ADR 0011](adr/0011-name-postmodem.md)),
configurable permalinks with phpBB2-classic as default ([ADR 0012](adr/0012-configurable-permalinks.md)),
Kysely for portable SQL ([ADR 0013](adr/0013-kysely-for-portable-sql.md)),
post markup dialect, class-based output and reader holes ([ADR 0014](adr/0014-post-markup.md)),
permission resolution: never, nearest scope, most specific subject ([ADR 0015](adr/0015-permission-resolution.md)).

No architecture decisions are open. Owner actions before going public:
register `postmodem.app`, create the `postmodem-bbs` GitHub and `@postmodem`
npm organisations, and get the licence's extension exception reviewed.
