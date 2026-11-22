# M2c — Vanilla parity

Status: **planned** · 2026-11-23 · after [M2b](M2.md), before [M3](../DESIGN.md#10-delivery-plan) ·
[ADR 0004](../adr/0004-core-is-vanilla-phpbb2.md) · epic
[#128](https://github.com/postmodem-bbs/postmodem/issues/128)

## Goal

The end product is a vanilla phpBB2 board, modernised, with Przemo's features added as
packages that can be switched off ([ADR 0004](../adr/0004-core-is-vanilla-phpbb2.md)). Comparing
the code with vanilla phpBB2 on 2026-11-23 found core features that are missing or only half
built. M2c finishes them, in core, so that a board running the `vanilla` profile does
everything phpBB2 did, and the Przemo packages of M3 build on complete foundations.

Half built since M1: **ranks** (imported, never shown), **polls** (shown, no voting or
creating) and **avatars** (shown, can't be managed). Missing: word censor, smilies admin and
picker, group control panel, who's online page, search shortcuts, forum pruning, mass
e-mail, jumpbox, FAQ, editing members in the admin panel, and the remaining profile fields
and preferences.

## Sorting the work

| Was it in vanilla phpBB2 2.0.x? | Where it goes | Label |
|---|---|---|
| Yes | Core, in every profile (this milestone) | `scope: vanilla` |
| No, Przemo added it | A package, off on a `vanilla` board (M3 or later) | `scope: przemo` |
| Neither: Postmodem's own platform, ops or theming work | wherever it fits | none |

[PACKAGES.md §0.1](../PACKAGES.md) lists the vanilla baseline. Where a feature has a vanilla
part and a Przemo part, the issue says which is which. For example, single-choice polls are
core (#137) and `polls-plus` adds the rest (#54). Profile fields are core (#133), and
admin-defined fields that can be required at registration are the `custom-fields`
package (#150).

## Slices

Every page: e2e + axe in each shipped theme, works without JavaScript, English and Polish.
Where phpBB2 had the data, the importer carries it over in the same issue: these are core
tables, so they don't wait for the Beta phase ([ADR 0024](../adr/0024-importer-work-in-the-beta-phase.md)
covers package data only).

### Slice 1 — Members and profiles (~13 d)

| Issue | What |
|---|---|
| [#129](https://github.com/postmodem-bbs/postmodem/issues/129) | **Bug:** members can't set their time zone, language or date format, so digests go out on UTC |
| [#130](https://github.com/postmodem-bbs/postmodem/issues/130) | Ranks: show post-count and special ranks, manage them in the admin panel |
| [#131](https://github.com/postmodem-bbs/postmodem/issues/131) | Avatars: upload, gallery and remote (cached on the board), with admin limits |
| [#132](https://github.com/postmodem-bbs/postmodem/issues/132) | Profile page: avatar, signature, rank, PM link, e-mail a member through the board |
| [#133](https://github.com/postmodem-bbs/postmodem/issues/133) | Occupation, interests and messenger fields (**decision**) |
| [#134](https://github.com/postmodem-bbs/postmodem/issues/134) | Member preferences: e-mail visibility, online status, signature and markup defaults |
| [#135](https://github.com/postmodem-bbs/postmodem/issues/135) | Board settings for signatures |
| [#136](https://github.com/postmodem-bbs/postmodem/issues/136) | Admin: edit a member's profile, rename and delete members |

### Slice 2 — Posting (~6 d)

| Issue | What |
|---|---|
| [#137](https://github.com/postmodem-bbs/postmodem/issues/137) | Polls: create, vote, edit and close (blocks `polls-plus`, #54) |
| [#138](https://github.com/postmodem-bbs/postmodem/issues/138) | Word censor with an admin page |
| [#139](https://github.com/postmodem-bbs/postmodem/issues/139) | Smilies: picker in the editor and a smilies admin |
| [#140](https://github.com/postmodem-bbs/postmodem/issues/140) | Per-post options and topic review |

### Slice 3 — Community (~6 d)

| Issue | What |
|---|---|
| [#141](https://github.com/postmodem-bbs/postmodem/issues/141) | Group control panel: join, leave and moderate groups |
| [#142](https://github.com/postmodem-bbs/postmodem/issues/142) | Who's online: names, guests, the record, the online page |
| [#143](https://github.com/postmodem-bbs/postmodem/issues/143) | Search shortcuts (your posts, unanswered, new) and the remaining options |
| [#144](https://github.com/postmodem-bbs/postmodem/issues/144) | Memberlist: the remaining sort orders and top posters |

### Slice 4 — Administration, navigation, messages (~7 d)

| Issue | What |
|---|---|
| [#145](https://github.com/postmodem-bbs/postmodem/issues/145) | Forum pruning, by hand and on a schedule |
| [#146](https://github.com/postmodem-bbs/postmodem/issues/146) | Mass e-mail to all members or a group |
| [#147](https://github.com/postmodem-bbs/postmodem/issues/147) | Jump-to-forum box |
| [#148](https://github.com/postmodem-bbs/postmodem/issues/148) | FAQ and BBCode guide |
| [#149](https://github.com/postmodem-bbs/postmodem/issues/149) | PM outbox and save box (**decision**) |

## Open decisions

1. **Messenger and other legacy profile fields** (#133): which become core fields. Proposed:
   occupation and interests as fields, the four messenger IDs as a contact list a board can
   switch off.
2. **PM folders** (#149): phpBB2's four folders, or the conversations with an archive that
   [PARITY.md §7](../PARITY.md#7-private-messages) planned.

## Done when

- Every sub-issue of #128 is closed.
- Each feature works on a `vanilla` board in the CI matrix, and the `essentials` packages
  still work on top of it.
- The importer carries over the matching phpBB2 data, and M1's demo goal "signatures and
  ranks show" holds.
