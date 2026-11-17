# Postmodem — Przemo feature parity matrix

Status: **draft** · 2026-11-17 · companion to [DESIGN.md](DESIGN.md)

Source: the legacy ACP (`admin/`), board settings (`lang_admin_board.php`,
~200 toggles), user preferences (`customize.php`) and the Przemo-specific
scripts in `old_przemo_phpBB/`. Each row says where the feature goes in Postmodem.

**Where it goes:** **Core** · **Module** (tier-2, first-party) · **Add-on**
(tier-1, first-party) · **Theme** (a theme option or token, not a feature) ·
**Setting** (a typed setting on an existing feature) · **Infra** (container/env
config, not the ACP) · **Dropped** (with reason).

Parity rule: anything not *Dropped* must be reachable in a default install,
and everything above Core must be switchable off, as in Przemo.

> **Package names here are provisional.** [PACKAGES.md](PACKAGES.md) re-cuts
> the same features strictly as "core = vanilla phpBB2, everything Przemo added
> = a package", using Przemo's uninstaller as the source of truth. Where the two
> disagree (e.g. revisions, read tracking and lockout were "Core" here),
> PACKAGES.md wins.

---

## 1. Board structure & index

| Przemo feature | Where | Notes |
|---|---|---|
| Categories, forums, sub-forums (hierarchy, "Tree/Medium/Full" packing) | Core | Node tree. Index packing level becomes a per-user **display preference** (§9) |
| Split categories on index, sub-level links in descriptions | Theme | Theme options with per-user override |
| Last topic title on index (+ length) | Core / Theme | Data from core; truncation is a theme concern (CSS line-clamp) |
| "New topics in this forum" counters on index | Core | Falls out of read-tracking |
| Forum pruning (`forum_prune`) | Module `moderation` | Scheduled job with dry-run |
| Link forums | Core | Node `kind: link` |
| Jumpbox (+ colour/size/glow styling) | Theme | Accessible combobox/nav. Glow/shadow options dropped |
| Board message (index only / all pages) | Add-on `announcements` | Plus dismissible banners and scheduled start/end |
| Own links in menu module | Core setting | Navigation editor in the ACP |
| Hit counter, page generation time (admin-only option) | Add-on `stats` / Core | Generation time → `Server-Timing` header + admin-only footer |
| "Who visited today", last visitors | Module `presence` | Privacy: opt-out per user, aggregate-only for guests |
| Who's online + record | Module `presence` | |
| Quick style switcher on index | Theme | Theme picker in header; also follows OS light/dark |
| Quick login / quick registration boxes | Core | |
| META keywords/description, refresh | Core setting | Plus OpenGraph, JSON-LD (`DiscussionForumPosting`), sitemap.xml. Meta refresh dropped |

## 2. Topics & posts

| Przemo feature | Where | Notes |
|---|---|---|
| Topics, posts, sticky/announce/global announce | Core | |
| Post/topic icons | Add-on `post-icons` | Per-theme icon sets, as in Przemo |
| Topic colours (all / mods only) | Add-on `topic-colours` | Restricted to theme palette tokens so contrast stays AA |
| Topic start date (+ format) | Core / Theme | Locale-aware formatting, no format setting |
| Mark topics you posted in | Core | Read-tracking flag |
| Hot/popular threshold | Core setting | User-overridable (§9) |
| **Split (merge) double messages**: a consecutive post by the same author within N hours is appended to the previous one, with separate thresholds for admin/mod | Core setting | Shows a "merged at" separator and a revision |
| **Post/topic expiry** (`expire`, quick-reply "expire in N days") | Module `moderation` | Scheduled unpublish → soft-delete, visible in the mod log |
| Edit time limit | Core setting | Per role via a capability (`post.edit.own` with a time window) |
| Protect admin posts from mod edits | Core | Expressed as a permission rule, not a special flag |
| **Post edit history** (days to keep, min chars diff, mod view/delete) | Core | Revisions with diff view. Retention and "trivial edit" threshold are settings; capabilities `revisions.view`, `revisions.purge` |
| "Edited by" / show self-edit / edits by others / hide admin edits | Core | One "edit notice" policy setting |
| **Moderation action notices** (show who locked/unlocked/moved/expired; mods may delete the notices) | Module `moderation` | Rendered as inline timeline events in the topic |
| Notify author on delete/move (method: PM/email; mods may skip) | Module `moderation` | Via `notifications`; "silent" option needs a capability |
| Topic review on reply, topic preview | Core | |
| Post preview on hover (overlib "cloud") | Theme | Accessible popover with the first N chars; keyboard/focus triggered; off on touch |
| Who viewed this topic (all / admins & mods only) | Module `read-tracking` | Opt-in, retention-limited; GDPR note in the privacy policy |
| Hide "who viewed" / hide "edited" for admin actions | Setting | |
| Polls | Module `polls` | |
| "Helped" points | Module `reactions` | A "helpful" reaction that feeds user points; plus a "solved" marker |
| Printable view | Theme | Print stylesheet, no separate page |
| Open all links in new window | Dropped | Hurts accessibility; external links get `rel="noopener nofollow ugc"` and an icon |

## 3. Posting & markup

| Przemo feature | Where | Notes |
|---|---|---|
| BBCode with per-button toggles (b, i, u, quote, code, list, img, url, center, fade, scroll, hide) | Module `editor` | Each tag is a registered markup plugin, enabled per role |
| `[hide]`: content hidden until the reader replies | Module `editor` | Server-side check, never just CSS. Hidden from feeds and federation |
| `[fade]`, `[scroll]` | Add-on `fun-bbcode` | Animation respects `prefers-reduced-motion`. Marquee replaced by CSS |
| FrEaK & l33t text buttons | Add-on `fun-bbcode` | Editor-side text transforms |
| HTML in posts, allowed tags; HTML per role (admin/jr admin/mod) | Module `editor` | Sanitised allow-list only, granted by the capability `markup.html` |
| BBCode/smilies restricted for guests; max smilies per post | Setting | |
| Smilies (+ ACP manager, path) | Module `editor` | Packs importable from the legacy `smilies` table |
| Quick reply (last page only, hidden for guests, expiry option) | Core | Same editor, collapsed |
| Word censor (+ admins/mods see the original) | Module `moderation` | Capability `censor.bypass` |
| Flood interval | Core setting | Per-role rate limits |
| Max poll options | Setting | |
| Custom BBCode (via XS/mods) | Add-on platform | Declarative tags (DESIGN §6.2) |

## 4. Users & profiles

| Przemo feature | Where | Notes |
|---|---|---|
| Registration, activation (none/user/admin), rules shown before registering | Core | Rules acceptance is stored with a version |
| Image confirmation code (`anti_robotic_reg`) | Module `antispam` | Pluggable CAPTCHA, proof-of-work default (no third party) |
| COPPA (fax/mail) | Dropped → reworked | A minimum-age gate setting plus GDPR consent; COPPA paperwork flow dropped |
| Required fields at registration (gender, location, website, GG) | Module `profiles` | Any profile field can be "required at registration" |
| Profile fields toggles (ICQ, AIM, YIM, MSN, GG, occupation, interests…) | Module `profiles` | Become **default field definitions** (only the useful ones seeded); the legacy importer maps the old ones to custom fields |
| **Custom profile fields** (text/textarea/select, min/max, numeric, required, placement above/under post, under avatar, in profile, auto-link) | Module `profiles` | Same placements as Przemo, as slots; plus visibility per field (public/members/staff) |
| Gender, age | Module `profiles` | Optional fields, off by default |
| Avatars (gallery/remote/upload, size limits) | Module `profiles` | Remote avatars are proxied/cached (privacy). Alt text |
| Profile photos | Module `profiles` | |
| Signatures (max length per role, images, size limits, `[img]` off) | Module `profiles` | |
| Username changes | Setting | With history and a cooldown |
| Custom rank text (+ length, mods allowed) | Module `ranks` | |
| Custom username colour (+ mods, view-only switch) | Module `ranks` | Contrast-checked against the active theme |
| User levels/ranks under avatar, post count, joined, location, online status in topic view | Theme | One "post author card" component with per-field toggles |
| Ignore users (button toggle) | Module `read-tracking` → rename `ignore` | Also hides them in PMs and the shoutbox |
| Ignore topics | Module `read-tracking` | |
| Email user via board form | Core setting | Relayed, sender address never exposed |
| "Tell a friend" | Add-on `share` | |
| Delete account (+ notify user by e-mail) | Core | GDPR erasure: anonymise posts or delete, chosen by policy |

## 5. Security & sessions

| Przemo feature | Where | Notes |
|---|---|---|
| Login lockout after N failures, block time | Core | Per account + per IP, exponential backoff |
| Password complexity, min length, ≠ login | Core | Replaced by length + breached-password check (HIBP k-anonymity, optional) per NIST 800-63B |
| Autologin, session length | Core | Remember-me tokens, rotated; device list in the user CP |
| Cookie name/path/domain/secure | Infra | Derived from `POSTMODEM_PUBLIC_URL`; always Secure/HttpOnly/SameSite |
| "Check connect address" | Infra | `postmodem doctor` checks the public URL |
| Global `$_GET` protection | Dropped | Replaced by validation at every boundary |
| Log all `$_POST` variables | Dropped | Privacy and secret-leak risk. Audit log covers what matters |
| Log hosts/IPs; mods may view IPs; whois link | Module `moderation` | Capability `user.viewIp`, configurable whois/ASN lookup, IP retention limit |
| Ban tron (user/IP/email), disallowed names | Module `moderation` | |

## 6. Moderation & administration

| Przemo feature | Where | Notes |
|---|---|---|
| Mod CP (move/lock/split/merge/delete) | Module `moderation` | |
| Report post (popup, per-user/group restrictions, admin-only mode) | Module `moderation` | Report inbox; who may report is a capability |
| **Warnings** (value, reason, archive, auto-deny-posting / auto-ban thresholds, public to mods, expiry) | Module `warnings` | |
| **Topic spy** (mods see which topics a user viewed; admins protected) | Module `moderation` | Kept but off by default; capability `user.viewActivity`; admins exempt by rule; the access itself is audit-logged |
| Junior Admin | Core | Role with a subset of `admin.*` |
| Admin/mod action logs | Core | Audit log |
| Mass e-mail | Module `notifications` | Queued, throttled, unsubscribe link |
| Prune inactive users, delete users, prune a user's posts | Module `moderation` | With dry-run previews |
| Post count resync, forum stats resync | Infra / CLI | `postmodem repair` jobs, also runnable from the ACP |
| Search index rebuild | Module `search` | Background job with progress |
| FAQ editor | Add-on `pages` | General static pages (FAQ, rules, privacy) with Markdown |
| Staff page (+ which forums) | Add-on `staff` | |
| Statistics page (15 stat modules) | Core data + Add-on `stats` widgets | |
| Admin notifications via GG (new reply / all messages) | Module `notifications` | Admin notifiers: email, web push, Matrix, Discord/Slack webhook |
| Update check | Core | Shows the latest release from the registry; opt-out; no phone-home on every request |
| Hidden admin-only previews/edits | Setting | |

## 7. Private messages

| Przemo feature | Where | Notes |
|---|---|---|
| Inbox/sent/save boxes with limits (admin ×6, mod ×3) | Module `messages` | Conversations replace boxes; quotas per role, archive instead of "savebox" |
| PM attachments | Module `messages` + `attachments` | |
| PM graphic quota bar | Theme | |
| ACP PM viewer (`admin_priv_msgs`) | Dropped → reworked | Admins read PMs only when they're **reported**; privacy by default |

## 8. Attachments

| Przemo feature | Where | Notes |
|---|---|---|
| Extension groups, forbidden extensions, per-user/group quotas, thumbnails, download counter, per-forum rules (`attach_rules.php`), user attachment CP (`uacp.php`) | Module `attachments` | Content sniffing instead of trusting extensions. EXIF stripped. S3 storage optional |

## 9. Per-user display preferences (`customize.php`)

Przemo let users switch off almost every page element, stored in cookies.
Postmodem makes this a **core preferences framework**: preferences are declared by
core, modules, add-ons and themes (typed, with defaults and an admin "force"
override), stored server-side for members and in a cookie for guests.

Seeded preferences: show avatars · show signatures · show signature images ·
topics/posts per page · popular threshold · index packing (tree/medium/full) ·
split categories · last topic titles (+ length) · sub-level links · who's
online box · ignore buttons · ignored topics box · header avatar · reduced
motion / density / font size (new) · theme + light/dark (new).

## 10. Presentation & theming

| Przemo feature | Where | Notes |
|---|---|---|
| XS styles: install, import/export, clone, edit templates in browser, per-style config | Core theming | Token editor in the ACP; template overrides only via theme bundles; clone = "duplicate theme" |
| 14 official styles | Theme | Classic + Modern ship; community themes as bundles |
| Per-style rank images & topic icons | Theme | Kept |
| Forum width, table width, colours, borders | Theme | Tokens |
| Text instead of icons under posts / turn off post-footer icons | Theme | Labelled buttons by default (accessible); icon-only is a theme option |
| Turn off original header | Theme | |
| Page loading "please wait" | Dropped | Not needed with streaming SSR |
| Overlib effects | Theme | See post preview above |

## 11. Ads & monetisation

| Przemo feature | Where | Notes |
|---|---|---|
| Header/footer banners, exchange banners, adverts, "advert person" | Add-on `ads` | Slot-based, off by default; no third-party scripts unless the admin adds them, and if they do, CSP is relaxed only for those slots |

## 12. Operations

| Przemo feature | Where | Notes |
|---|---|---|
| Installer with file integrity check | Infra | `postmodem init` + image signature verification |
| `check_files` / system check | Infra | `postmodem doctor` |
| DB backup (copies, schedule, search tables) / dbloader restore | Infra | `postmodem backup`/`restore` |
| PhpMyAdmin / SQL console | Dropped | Security. Use DB tooling directly |
| Autorepair tables | Dropped | Not a MySQL MyISAM world anymore |
| GZip compression | Infra | Reverse proxy / built-in compression |
| SMTP settings | Infra | `POSTMODEM_MAIL_URL` |
| Email sig, from, return path | Setting | |
| phpBB2 ⇄ Przemo updater, uninstaller to vanilla phpBB2 | Module `importer` | Import from phpBB2/Przemo/phpBB3; export to a documented JSON dump format |
| Gadu-Gadu number/password config | Dropped → reworked | Notifier providers |
| `fetchposts.php` | Module `syndication` | Feeds + JSON API + embeddable widgets |
| `shoutbox` | Add-on `shoutbox` | Reference add-on (DESIGN §6.5) |

---

## Summary

- **Dropped outright:** 7 items, all for security, privacy, or because the
  problem no longer exists (meta refresh, `$_GET` protection, POST logging,
  SQL console, autorepair, loading screen, links in new windows).
- **Reworked:** COPPA → age gate, PM viewer → reported-only, GG → notifiers,
  password rules → NIST.
- **New in the design because of this audit:** merging double posts, post
  expiry, `[hide]` BBCode, moderation action notices, author notifications on
  delete/move, the per-user preferences framework, a general `pages` add-on,
  an `announcements` add-on, and the `fun-bbcode` and `post-icons` add-ons.
