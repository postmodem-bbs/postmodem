# ADR 0009 — Federation: an optional, reversible module, with the core prepared for it

- Status: accepted · 2026-11-17

## Context
ActivityPub federation would let people on Mastodon, Lemmy and other
fediverse software follow Postmodem forums and reply to them. FEP-1b12 (group
federation) is the de-facto standard for forums. Thread/context modelling
(FEP-7888 and related) is still being reconciled. NodeBB ships federation
built in and on by default; its experience shows that most of the cost is
**moderation** of remote content, not the protocol.

The project owner's constraint: federation must be **completely optional and
reversible**; core or module doesn't matter beyond that.

## Decision

### 1. The protocol is a tier-2 module: `federation` (milestone M5)
Off by default; enabled per forum. Phase 1: local forums are FEP-1b12 Groups
that remote users can follow and reply to. Phase 2: local users can follow
remote communities (remote content lives in a separate, auto-pruned area).
Includes: inbox/outbox with HTTP signatures, instance blocklist/allowlist,
incoming remote reports (`Flag`), remote media cached into storage, and SSRF
protection shared with outgoing webhooks.

### 2. The core is prepared now (cheap, needed anyway)
1. **Permanent, never-reused URLs** for users, forums, topics and posts; slugs
   are separate from IDs.
2. **Authors may be remote**: the core never assumes "author = local user".
   Remote actors are rows with an `origin`, no login, and a `remote` role in
   the permission system.
3. **Remote HTML is a markup source** (sanitised), alongside BBCode and Markdown.
4. **Deletions are tombstones** (visibility states), and visibility states and
   render "outside contexts" carry a `federate` rule (already designed in
   EXTENSION-POINTS §2.1 and §7.2).
5. **Unregistered visibility states fail closed**: if the package that
   registered a state is disabled or uninstalled, content in that state is
   hidden and excluded from counts until an admin decides otherwise. This is
   what makes uninstalling *any* package safe, federation included.

### 3. Reversibility contract
| Action | Effect |
|---|---|
| **Enable for a forum** | The ACP shows, before confirming, what can't be undone: copies already delivered to other servers can only be *asked* to be deleted |
| **Pause a forum** | Stop sending and accepting; followers kept; the Group actor answers "temporarily unavailable". Fully reversible |
| **Leave (per forum or board-wide)** | Send `Delete` for the Group actor and `Undo` for follows; drop remote followers. Remote replies in local topics: admin chooses **keep as archived** (read-only, attributed, never re-federated) or **remove** (tombstoned, then purged) |
| **Uninstall the module** | Same as "leave" board-wide; remote actors, keys, delivery logs and cached media purged after the standard grace period (PLATFORM-SERVICES §14). Local users and local content are **never changed** |
| **Re-enable later** | Works from scratch with fresh keys; previous followers must re-follow |

Local content, local users and their permissions never depend on federation
being installed.

## Consequences
- ADR 0004 holds: the protocol is a package, the core only gains generic
  capabilities (remote authors, HTML source, fail-closed states) that other
  packages benefit from too (e.g. importers, guest posts).
- Admins who never enable it carry no moderation burden and no extra load.
- Stack: no new services. When enabled, more worker jobs (delivery with
  retries, media fetching) and outbound traffic.
- The privacy page and erase hooks must state the limit honestly: federated
  copies can only be requested to be deleted.
- FEP-7888 is still moving; the module targets FEP-1b12 first and follows the
  Threadiverse working group for thread context.
