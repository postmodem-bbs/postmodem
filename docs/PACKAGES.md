# Postmodem — Przemo, unbundled: package catalog & infrastructure profile

Status: **draft** · 2026-11-17 · companions: [DESIGN.md](DESIGN.md) · [PARITY.md](PARITY.md) · [CONTAINERS.md](CONTAINERS.md)

> **Design document.** It describes where Postmodem is going, so parts of it are planned, not
> built. For installing, running and developing the board as it is today, see the
> [guides](README.md).

## 0. The exercise

**Rule:** the core does what **vanilla phpBB 2.0.x** did. Everything Przemo
added on top is moved into a package: a tier-1 **add-on**, a tier-2
**module**, or a capability of the **platform services** that packages share.
Then for each package we ask what it needs: data shape, write pattern, jobs,
realtime, blobs, search, outside services. Adding those answers up tells us
which extension points the core must expose and what the Docker stack must
include.

**Source of truth for "what Przemo added":** Przemo's own uninstaller,
`old_przemo_phpBB/admin/admin_uninstall.php`, which reverts a board to vanilla
phpBB2. It drops **24 tables**, **~110 columns** on 14 vanilla tables and
**~290 config keys**. Every one of them is accounted for below. Where the
meaning wasn't obvious, it was checked in the code that uses it.

### 0.1 Core baseline (vanilla phpBB2, modernised)

What of this is still missing is planned in [M2c](milestones/M2c.md); issues carry the label
`scope: vanilla`, and package issues `scope: przemo`.

Categories/forums · topics (normal/sticky/announcement) · posts · single-choice
polls · BBCode (vanilla tag set) · smilies · word censor · users, profiles with
the vanilla fields · avatars · signatures · ranks (post-count & special) ·
groups (open/closed/hidden, group moderators) · per-forum, per-group and per-user permissions ·
private messages · email topic notifications · search · who's online (with
record) · memberlist · moderator CP (lock/move/split/delete) · ban (user/IP/email) ·
disallowed names · prune · mass email · styles · i18n · visual-confirmation
CAPTCHA (vanilla had it from 2.0.11; it becomes a provider interface) ·
"new since last visit".

### 0.2 Deliberate exceptions (Przemo features that stay in core)

Each one is either structural (an extension would need it to exist anyway)
or a 2026 baseline that every peer product has:

| Kept in core | Przemo origin | Why core |
|---|---|---|
| Nested node tree | `categories.cat_main*` (sub-forums) | Structural; retrofitting nesting through an extension would distort every query |
| Audit log | `logs` | Packages write to it; moderation and security depend on it |
| Roles & scoped grants | `jr_admin_users`, `users.disallow_forums`, `user_jr` | Absorbed: these become role assignments, so no package is needed |
| Typed settings | ~290 config keys | Packages declare their own; the flat config table disappears |
| Global announcement *type slot* | `auth_globalannounce` | Only the extension point "register a topic type" is core; the type itself is a module (§2.2) |

Everything else follows the rule, including things one might expect in core.

---

## 1. Platform services discovered by this exercise

The original design (DESIGN §6.2) listed collections, channels, settings,
capabilities, slots, events, markup and i18n. Unbundling Przemo adds three,
because without them a dozen small features would have to be tier-2 modules
for no good reason:

| Service | What it does | Who needs it |
|---|---|---|
| **Entity fields** *(new)* | A package declares typed extra fields on core entities (`user`, `forum`, `topic`, `post`, `group`): type, validation, who may set/see it, form placement, render slot, `searchable`, `requiredAtRegistration`. Stored in **side tables keyed by the entity id**, never as new columns on core tables. Admin-defined fields use the same mechanism. | custom profile fields, gender, topic subtitle, topic prefixes, topic colour, post icons, forum colour, group colour/prefix, required registration fields |
| **Counters** *(new)* | Named, write-behind counters and "seen" sets: increment in memory (solo) or in Valkey (stack), flushed to the DB in batches. Exact-ish totals, unique-per-period sets (HyperLogLog on Valkey, a table on DB). | topic views (vanilla too), who-viewed, hit counter, time online, visit counts, link-forum hits, download counts, "visited today" |
| **Preferences** *(new, in DESIGN §5.2)* | Per-user typed preferences declared by packages; admin can force | display preferences, every "show X" toggle |
| Collections | Per-package JSON document stores with access rules | shoutbox, ads, announcements, pages, nav links |
| Channels | Realtime pub/sub | shoutbox, presence, live topic updates, mod-queue badge |
| Settings · Capabilities · Slots · Markup · i18n | as DESIGN §6.2 | everyone |

With entity fields and counters available, a large share of Przemo becomes
**tier 1**: HTML/JS plus a manifest.

## 2. Package catalog

Legend — **T1** add-on · **T2** module · Data: **R** relational (low write),
**A** append-heavy log, **C** counters, **B** blobs, **F** full-text,
**RT** realtime, **J** background/scheduled jobs.

### 2.1 Forums & listing

| Package | Tier | Replaces (legacy) | Data | Needs from core / platform |
|---|---|---|---|---|
| `forum-password` | T2 | `forums.password` | R (hash per forum), session grant | access-check filter; session-scoped grant store |
| `link-forums` | T2 | `forum_link*`, `forum_link_hit*`, `main_type` | R + C (hits) | register node kind; counters |
| `listing-options` | T1 | `forum_sort`, `locked_bottom`, `forum_separate`, `forum_color` | entity fields on forum | **listing sort/group hook** (declarative: "sort by", "pin locked last", "separate announcements") |
| `no-count-forums` | T2 | `forums.no_count` | entity field | post-count contribution filter |
| `trash-bin` | T2 | `forums.forum_trash`, "Delete to trash" | R | delete → move interception; visibility predicate |
| `global-announcements` | T2 | `auth_globalannounce`, `forum_show_ga` | R | register topic type; capability; listing query modifier |
| `topic-prefixes` | T1 | `forums.topic_tags` | entity field (forum: allowed list) + (topic: enum) | entity-field validation that depends on another field |
| `topic-subtitle` | T1 | `topics.topic_title_e`, `title_explain` | entity field, `searchable` | search contribution (via entity fields) |
| `topic-colours` | T1 | `topic_color*`, `can_topic_color` | entity field + capability | theme palette tokens |
| `post-icons` | T1 | `post_icon`, `topic_icon` | entity field (enum) + theme assets | per-theme asset lookup |
| `topic-start-date` | T1 | `topic_start_date*` | none (core data) | slot in topic row |

### 2.2 Posting & content lifecycle

| Package | Tier | Replaces | Data | Needs |
|---|---|---|---|---|
| `revisions` | T2 | `posts_text_history`, `ph_*`, `post_edit_by` | **A** (full text per edit; retention by days + min diff) + **J** prune | `post.beforeUpdate` with old body; diff renderer; capabilities |
| `edit-policy` | T2 | `edit_time`, `not_edit_admin`, `show_action_edited_*`, `hide_edited_admin` | settings | edit permission filter (time window, target author's role) |
| `post-merge` | T2 | `split_messages*`, `posts.post_start_time` | side field | `post.beforeCreate` may **transform** a create into an append |
| `expiry` | T2 | `post_expire`, `topic_expire`, `expire*` | entity field + **J** (scheduler) | visibility predicate; scheduled job |
| `premoderation` | T2 | `forum_moderate`, `post_approve`, `topic_accept` | R (queue) + RT (mod badge) | **visibility predicate**; queue UI slot; notifications |
| `author-delete` | T2 | `posts.poster_delete` | side field | delete interception → tombstone render |
| `topic-timeline` | T2 | `topic_action*`, `show_action_*`, `allow_mod_delete_actions` | **A** | moderation events (lock/move/expire/merge) with actor |
| `threaded-view` | T2 | `post_parent`, `post_order`, `forum_tree_*`, `topic_tree_width` | side table (parent, order) | alternate topic renderer; reply-to in posting |
| `quick-reply` | T1 | quick_reply.php, `quick_reply_pages`, `not_anonymous_quickreply` | none | slot + a form posting to the core reply endpoint |
| `post-preview` | T1 | `overlib`, `post_overlib`, `topic_preview` | none | read-only API for excerpts |
| `print` | T1 | printview.php | none | print stylesheet slot |
| `polls-plus` | T2 | `vote_max`, `vote_hide`, `vote_tothide`, `vote_voted`, `vote_cast` | R | extends core poll model (multi-choice, hidden results, record of who voted what) |
| `post-user-agent` | T2 | `posts.user_agent`, `cagent` | side field | **request context in events** |
| `marked-posts` | T2 | `posts.post_marked` | side field | mod action + search filter *(exact semantics to confirm)* |

### 2.3 Markup

| Package | Tier | Replaces | Data | Needs |
|---|---|---|---|---|
| `bbcode-extras` | T1 | `button_*` (center, fade, scroll), `color_box`, `allow_bbcode_quest`, `restrict_smilies`, `max_smilies`, `smile_order` | settings | declarative tags; per-role tag toggles |
| `fun-text` | T1 | `freak` (FrEaK & l33t) | none | editor toolbar slot |
| `hide-until-reply` | T2 | `[hide]` | none | **render filter with viewer context**; excluded from feeds, federation and search snippets |
| `html-markup` | T2 | `admin_html`, `jr_admin_html`, `mod_html` | settings | sanitiser allow-list by capability |

### 2.4 Users, profiles, groups

| Package | Tier | Replaces | Data | Needs |
|---|---|---|---|---|
| `custom-fields` | T1 | `custom_fields` ACP, `require_*`, `cicq/cyahoo/cmsn/cgg/cjob/cinter` | entity fields (admin-defined) | ACP builder for the platform service |
| `gender` | T1 | `user_gender`, `gender`, `require_gender` | entity field | — |
| `profile-photo` | T2 | `user_photo*`, `photo_*`, profilephoto_mod.php | **B** + image pipeline | storage provider; image resize/strip-EXIF job |
| `signature-images` | T2 | `user_sig_image`, `sig_image*` | **B** + image pipeline | same |
| `avatar-plus` | T2 | `user_avatar_width/height`, `allow_avatar` per post | R | extends core avatars |
| `ranks-plus` | T2 | `rank_group`, `special_rank`, `user_custom_rank`, `can_custom_ranks`, `custom_rank_mod` | R | rank resolution filter |
| `name-colours` | T1 | `user_custom_color`, `can_custom_color`, `custom_color_*`, `name_color`, `fontcolor_admin/jradmin/mod` | entity field + capability | contrast check against the active theme |
| `groups-plus` | T2 | `group_order/count/count_enable/mail_enable/no_unsub/color/prefix/style` | R + **J** (auto-join by post count) | `post.created` events; group mail via notifications |
| `ignore-users` | T2 | `ignores`, `cignore` | R (pairs) | **render filter with viewer context** (posts, PMs, shoutbox) |
| `ignore-topics` | T2 | `topics_ignore`, `ignore_topics` | R (pairs) | listing query modifier |
| `unread-tracking` | T2 | `read_history`, `rh_*`, `read_tracking_last_update`, `poster_posts` | **C/R high write** (per user×topic watermark) + **J** prune | listing decorator; topic open event. Core alone gives vanilla "new since last visit" |
| `activity-stats` | T2 | `user_spend_time`, `user_visit`, `user_session_start` | **C** | session heartbeat event |
| `display-preferences` | T1 | customize.php, `c*`/`l*` toggles, `*_over` overrides, `override_user_choices` | preferences | preferences service (seeds Przemo's ~25 toggles) |
| `quick-register` | T1 | `cregist`, `cregist_b` | none | slot + core registration endpoint |
| `registration-rules` | T1 | `show_rules` | collection (versioned rules text) + acceptance | registration validator (declarative "must accept doc X") |

### 2.5 Security & moderation

| Package | Tier | Replaces | Data | Needs |
|---|---|---|---|---|
| `login-security` | T2 | `max_login_error`, `block_time`, `user_badlogin/blocktime/block_by`, `min_password_len`, `force_complex_password`, `password_not_login`, `user_ip_login_check` | R + C (attempts) | **auth filters** (login attempt, password policy, session validation). *On by default; disabling it is discouraged* |
| `ip-logging` | T2 | `user_ip`, `clog`, `ipview`, `address_whois` | **A** + retention **J** | request context; capability `user.viewIp` |
| `bans-plus` | T2 | `ban_time/expire_time/by_userid/priv_reason/pub_reason*/host` | R | ban-check filter; expiry job |
| `reports` | T2 | report.php, `reporter_id`, `report_*` | R + RT (mod badge) | slots on post; notifications |
| `warnings` | T2 | `users_warnings`, `warnings_*`, `*_warnings` | R + **J** (expiry, thresholds) | sanctions: deny-posting / ban via permission grants |
| `mod-notices` | T2 | `del_notify_*`, `del_user_notify` | none | moderation events → notifications |
| `topic-viewers` | T2 | `topic_view`, `who_viewed*`, `hide_viewed_admin`, topic_spy.php, `mod_spy*` | **C high write** + retention **J** | topic open event; audit log for spy access |
| `censor-bypass` | T2 | `show_badwords` | none | render filter with viewer context |
| `admin-tools` | T2 | prune users, delete users, prune user posts, post-count resync, resync stats | **J** | bulk jobs with dry-run |

### 2.6 Attachments

| Package | Tier | Replaces | Data | Needs |
|---|---|---|---|---|
| `attachments` | T2 | 8 tables (`attachments*`, `attach_quota`, `extensions`, `extension_groups`, `forbidden_extensions`, `quota_limits`), `auth_attachments`, `auth_download`, `post_attachment`, `topic_attachment`, `privmsgs_attachment`, download.php, uacp.php, attach_rules.php | R + **B** + C (downloads) + **J** (thumbnails, scan, orphan GC) | storage provider; image pipeline; optional malware scan; upload streaming with quotas; signed download URLs; posting and PM slots |

The heaviest package: it's the main reason for blob storage, image processing
and (optionally) antivirus in the stack.

### 2.7 Community & presence

| Package | Tier | Replaces | Data | Needs |
|---|---|---|---|---|
| `shoutbox` | T1 | `shoutbox`, `shoutbox_config` | collection + **RT** | collections, channels, rate limits (DESIGN §6.5) |
| `visitors` | T2 | `u_o_t_d`, `visitors`, `last_visitors_time*`, `ccount` (hit counter) | **C** (unique per day) | counters with per-period unique sets |
| `helpful` | T2 | `helped`, `user_allow_helped`, `forum_no_helped`, `tr_color_helped` | R + C | reaction on post; user points |
| `staff` | T1 | staff.php, `staff_*` | none | read API: role members |
| `stats` | T2 | statistics.php, `stats_config`, `stats_modules` | **J** rollups → R | read-only query API for widgets; scheduled rollups |
| `stats-widgets` | T1 ×15 | each `stat_modules/*` | none (reads rollups) | widgets: latest/most active/most viewed topics, posts/topics/users per month, top posters, top smilies, top words, PMs, user agents, users by location, users by gender, top helpful, top advert, last active users |
| `share` | T1 | tellafriend.php, `cfriend` | none | Web Share API; email-a-friend via the core mail relay (rate-limited) |
| `seeker` | T2 | seeker.php | none | search API filters (author, date, forum) |
| `syndication` | T2 | fetchposts.php | none | feeds, embeds |

Some widgets depend on other packages: `top_helpful` needs `helpful`,
`user_agent` needs `post-user-agent`, `users_gender` needs `gender`,
`top_words` needs the search index. Widget manifests declare these as
optional dependencies and hide themselves when the dependency is missing.

### 2.8 Notifications

| Package | Tier | Replaces | Data | Needs |
|---|---|---|---|---|
| `notify-admin` | T2 | `admin_notify_*` | settings | `post.created` events |
| `notifier-push` / `-matrix` / `-webhook` | T2 | gg.php, `notify_gg`, `numer_gg`, `haslo_gg`, `user_notify_gg` | R (per-user endpoints/keys) | Notifier provider interface; outbound queue |

### 2.8a Beyond Przemo

Not a Przemo feature; listed here because it shapes the core and the stack.

| Package | Tier | Replaces | Data | Needs |
|---|---|---|---|---|
| `federation` | T2 | — | R (remote actors, keys, followers, delivery log) + **A** (inbox/outbox) + **B** (cached remote media) + **J** (delivery with retries, media fetch, pruning) | remote authors; HTML markup source; visibility states with `federate` flags and fail-closed behaviour; outside-context rendering; privacy hooks; SSRF-protected egress. Off by default, per-forum opt-in, reversible ([ADR 0009](adr/0009-federation-optional-module.md)) |

### 2.9 Presentation, site & monetisation

| Package | Tier | Replaces | Data | Needs |
|---|---|---|---|---|
| `theme-manager` | T2 | xs_mod (install/import/export/clone, `xs_*`) | **B** (theme bundles) | theme registry; ACP. No in-browser code editing, no FTP |
| `announcements` | T1 | `board_msg*` | collection | slots |
| `pages` | T1 | FAQ editor | collection (Markdown) | routes for add-on pages |
| `nav-links` | T1 | own links in menu | collection | nav slot |
| `seo` | T1 | `meta_keywords`, `meta_description` | settings | head slot |
| `debug-footer` | T1 | `generate_time*` | none | Server-Timing data |
| `ads` | T1 | `advertisement`, `adv_person`, `advert*`, `banner_*`, `echange_banner`, `banners_list`, `view_ad_by` | collection + C (impressions/clicks) + B (images) | slots; counters; per-slot CSP |

### 2.10 Not packaged

| Legacy | Outcome |
|---|---|
| `cookie_*`, `check_address`, `sendmail_fix`, `gzip_compress`, SMTP keys | Container/env config (CONTAINERS §3) |
| check_files.php, check_data.php, dbloader, db_backup, `autorepair_tables`, `rbuild_search`, scripts/update.php, admin_uninstall.php | `postmodem doctor` / `backup` / `repair` / `import` CLI |
| admin_sql.php / `sql` (PhpMyAdmin), `protection_get`, `clog_post`, `refresh`, `cload`, `open_in_windows`, `auto_date`, `header_enable`, `width_*`, `table_border`, `onmouse`, `glow_box`, `size_box`, `graphic`, `post_footer` | Dropped or turned into theme tokens (PARITY.md) |
| `anti_robotic_reg` | Core CAPTCHA provider (vanilla had visual confirmation) |
| `jr_admin_users`, `disallow_forums`, `user_jr`, PM limit multipliers | Absorbed by core roles and quotas |

### 2.11 Priority (2026-11-18, [ADR 0019](adr/0019-package-tiers-and-essentials-profile.md))

Przemo shipped everything switched on, and most boards turned much of it off again. Not
every package earns the same effort, so each one has a priority. These are judgement calls
(no usage data exists yet) and will be checked against the feature switches in early
adopters' report bundles (see below).

**A: must-have.** Why people chose Przemo, or what a public board needs to be run. Built by
the project, enabled by the default `essentials` profile (§5). Their importer slices follow in
the [Beta phase](milestones/Beta.md) ([ADR 0024](adr/0024-importer-work-in-the-beta-phase.md)).

| Package | Why |
|---|---|
| `unread-tracking` | Przemo's best-known feature: exact per-topic unread state |
| `attachments` | Expected on any board; the reason for blob storage |
| `quick-reply` | On nearly every board |
| `revisions` | Post history; moderators rely on it |
| `reports`, `warnings`, `bans-plus`, `ip-logging` | The moderation toolkit; IP logs are how ban evasion is spotted |
| `login-security` | On by default by design (§2.5) |
| `trash-bin` | Moderators "delete to trash" rather than for good |
| `helpful` | "Pomógł", the signature of Polish help boards |
| `polls-plus` | Multiple-choice polls and hidden results |
| `hide-until-reply` | Imported posts use `[hide]`; the reader-hole rendering already exists (ADR 0014) |
| `global-announcements`, `edit-policy`, `mod-notices`, `admin-tools` | Small, and expected by admins |

**B: worth having, off by default.** Built by the project after tier A; part of the `przemo`
profile. `shoutbox`, `groups-plus`, `name-colours`, `topic-prefixes`, `post-merge`,
`link-forums`, `forum-password`, `no-count-forums`, `ignore-users`, `ignore-topics`,
`custom-fields`, `premoderation`, `expiry`, `author-delete`, `syndication`, `stats` with a few
`stats-widgets` (latest, most active and most viewed topics, top posters), `theme-manager`, `visitors`, `staff`, `pages`, `announcements`, `nav-links`, `seo`, `print`,
`notify-admin`, `display-preferences`, `listing-options`, `topic-subtitle`, `topic-colours`,
`topic-timeline`, `registration-rules`, `profile-photo`, `ranks-plus`, `activity-stats`,
`share`, `seeker`, `bbcode-extras` (center and the colour picker only), `post-preview`.

**C: not built by the project.** Left to third parties; their legacy data is reported, not
imported.

| Why | Packages |
|---|---|
| Dated | `fun-text`, the fade/scroll/glow BBCode, `debug-footer`, `quick-register`, `topic-start-date`, `post-icons`, `signature-images`, `avatar-plus`, `gender` |
| Hostile to privacy or security | `topic-viewers` ("who viewed", moderator spy), `html-markup` (HTML in posts), `post-user-agent` |
| Dead service | the Gadu-Gadu notifier; `notifier-push` / `-matrix` / `-webhook` replace it as tier B |
| Unclear value for the effort | `threaded-view`, `marked-posts`, `censor-bypass`, `ads`, the other `stats-widgets` |

Extension points used only by tier C packages (alternate renderers, #10) stay in SDK v1's
design but are built last.

**Checking the tiers.** The anonymised report bundle gains the values of Przemo's on/off
feature switches (e.g. `cshoutbox`, `helped`, `read_tracking`): booleans with nothing
personal in them. Each bundle early adopters send then shows which features a real board
used, and the tiers move accordingly.

**Count:** about **75 packages**: ~30 T1 add-ons (counting the 15 stat
widgets) and ~45 T2 modules. That's a lot of packages, but most are small.
Installing Przemo's feature set in one step is handled by a **distribution
profile** (§5).

---

## 3. Extension points the core must expose

> Fully specified in [EXTENSION-POINTS.md](EXTENSION-POINTS.md). There, #1 is
> split into stored *visibility states* and per-reader *reader filters*, the
> render-cache idea in point 4 becomes "holes", and a 13th point (privacy
> export/erase) is added.

Derived from the "Needs" columns. These belong in SDK v1; anything missing
here will force a core patch later, the exact failure that killed Przemo.

| # | Extension point | Kind | Used by |
|---|---|---|---|
| 1 | **Visibility predicates**: contribute `WHERE` fragments / post-filters to every content query, given the viewer | query | premoderation, trash-bin, expiry, author-delete, ignore-topics, global-announcements |
| 2 | **Listing modifiers**: sort keys, grouping, extra rows, decorations | query + render | listing-options, global-announcements, unread-tracking, ignore-topics |
| 3 | **Content lifecycle filters**: `post.beforeCreate` (may transform), `beforeUpdate` (sees old + new), `beforeDelete` (may redirect to move/tombstone) | sync filter | post-merge, revisions, edit-policy, trash-bin, author-delete, premoderation |
| 4 | **Render filters with viewer context**, cached as *(content version × viewer-varying flags)* | render | hide-until-reply, ignore-users, censor-bypass, html-markup |
| 5 | **Access filters**: forum access, edit permission, post-count contribution, rank resolution | sync filter | forum-password, edit-policy, no-count-forums, ranks-plus |
| 6 | **Auth filters**: login attempt, password policy, session validation, ban check | sync filter | login-security, bans-plus, warnings |
| 7 | **Registries**: node kinds, topic types, capabilities, notifier providers, storage/search/captcha providers, theme assets | register | link-forums, global-announcements, everyone |
| 8 | **Request context on events** (IP, UA, locale, session) with privacy classification | data | post-user-agent, ip-logging, activity-stats |
| 9 | **Moderation events** with actor and reason | event | topic-timeline, mod-notices, reports, warnings |
| 10 | **Alternate renderers** for topic view | render | threaded-view |
| 11 | **Search contributions** (extra fields, filters, exclusions) | index | topic-subtitle (via entity fields), seeker, hide-until-reply, marked-posts |
| 12 | **Importer slices**: each package maps its own legacy tables/columns/config | import | every package with legacy data |

Point 12 means the Przemo importer isn't a monolith: core imports the vanilla
phpBB2 data, and each package imports its own part of the uninstaller's list.
A board can be imported with only some packages enabled; data for missing
packages is reported and skipped. Point 12 is built in the
[Beta phase](milestones/Beta.md) ([ADR 0024](adr/0024-importer-work-in-the-beta-phase.md)).

Point 4 is the hardest performance problem: rendered posts can no longer be
cached once for everyone. The design is to cache per content version, with a
small set of per-viewer **variation flags** declared by filters (e.g.
`hasReplied(topic)`, `ignores(author)`). This keeps the cache useful.

---

## 4. Infrastructure profile

### 4.1 Workload classes

| Class | Packages (examples) | Write pattern | Solo (SQLite) | Stack |
|---|---|---|---|---|
| **Relational, low write** | prefixes, ranks-plus, groups-plus, warnings, reports, bans-plus, polls-plus, forum-password | rare writes, joined reads | SQLite | Postgres |
| **Append-heavy logs** | revisions, ip-logging, topic-timeline, audit log | insert-only, prune by age | SQLite + retention jobs | Postgres; time-partitioned tables optional for ip-logging/audit |
| **High-churn counters & "seen" sets** | topic views, topic-viewers, unread-tracking, visitors, activity-stats, link/download/ad counters | many tiny writes per page view | **in-memory buffer → batched flush** (essential: SQLite has one writer) | **Valkey** buffer (INCR, HyperLogLog, sets) → batched flush to Postgres |
| **Realtime fan-out** | shoutbox, presence, premoderation/report badges, live topics | pub/sub | in-process | **Postgres LISTEN/NOTIFY** default; **Valkey pub/sub** when >1 web replica or high fan-out |
| **Rate limits & short-lived state** | shoutbox, login-security, share, flood control | per-request check | in-memory | Valkey (or a Postgres table with TTL sweep for small boards) |
| **Blobs + processing** | attachments, profile-photo, signature-images, ads, theme-manager, smilies | upload, thumbnail, download | `/data/uploads` + in-image libvips | S3 (Garage) when multi-host; same pipeline in `worker` |
| **Malware scanning** | attachments | per upload, async | off | **ClamAV** sidecar (opt-in profile) |
| **Full-text** | search, seeker, topic-subtitle, top_words widget | index on write, query on read | SQLite FTS5 | Postgres FTS; **Meilisearch** opt-in |
| **Rollups** | stats, stats-widgets | scheduled aggregate | scheduler job → tables | same; no separate OLAP store needed at forum scale |
| **Outbound integrations** | notifications, notifier-*, mod-notices, share, mass mail | queued, retried | DB queue | DB queue; worker egress |

### 4.2 Effect on the Docker stack

Compared with CONTAINERS.md §4.3:

| Service | Before | After this exercise |
|---|---|---|
| `Postmodem` web/worker/scheduler | — | Unchanged. **libvips** (via `sharp` prebuilt binaries, ~10–15 MB) is included in the runtime image so the image pipeline works in solo mode; keep it in the size budget |
| Postgres | stack DB | Unchanged; adds LISTEN/NOTIFY for channels |
| Valkey | optional `cache` profile | Renamed to profile **`scale`**, and **recommended** whenever web replicas > 1 *and* any of shoutbox / presence / topic-viewers / unread-tracking is enabled. Treated as **non-authoritative**: losing it loses at most one flush interval of counters, never data |
| Meilisearch | optional `search` | Unchanged |
| Garage (S3) | optional `s3` | Unchanged; needed when attachments are on and web/worker run on more than one host |
| **ClamAV** | — | **New** opt-in profile `av` (clamd over TCP; worker scans uploads asynchronously; files stay quarantined until scanned when enabled). ~1 GB RAM, so off by default and documented as such |
| Mailpit | dev only | Unchanged; the dev seed enables every package so all mail flows can be tested |
| GeoIP | — | **Not needed.** "Users from where" reads the profile location field, not IP geolocation |

Nothing in the catalog needs a document DB, message broker, or OLAP store.
**SQLite solo mode still runs every package**, with the in-memory
counter/channel backends. The only solo limits are single-process and no
virus scanning.

### 4.3 Consequences for dev & CI

- **Package matrix:** CI boots the image with each install profile:
  *vanilla* (core only), *essentials*, *przemo* (tiers A and B), and *random subsets* (nightly).
  That proves the core really is vanilla and packages don't secretly depend
  on each other.
- **Backend matrix for the services that have one:** counters and channels run
  against in-memory, Postgres and Valkey backends in integration tests.
- **Importer fixture:** the legacy MariaDB container (CONTAINERS §4.1) gets a
  dump that touches every uninstaller table/column, so each importer slice
  has data to test against (Beta phase, ADR 0024).
- **Load test** (k6, nightly) on the counter-heavy packages, solo and stack,
  feeding the soft resource budget in DESIGN §5.1.

## 5. Distribution profiles

Installing ~75 packages one by one would be miserable, so the image
includes **profiles** (a manifest listing packages + default settings):

| Profile | Contents |
|---|---|
| `vanilla` | Core only: a modern phpBB2 |
| `essentials` | Core + the tier A packages (§2.11). **The default for `postmodem init`** and for imports |
| `przemo` | Core + tiers A and B with Przemo's defaults, for boards that want the full set back |

`POSTMODEM_PROFILE=essentials` (or the setup wizard) chooses one; `modern`, an earlier idea
for a curated set without Przemo-era extras, is what `essentials` became. After that, every
package can be switched on or off individually, which is Przemo's "everything can
be turned off" promise kept literally.
