# ADR 0015 — Permission resolution: never, then nearest scope, then most specific subject

- Status: accepted · 2026-11-17 (M1 slice 5)

## Context
DESIGN §5.3 said "Never beats Allow beats unset; nearest scope wins", while
EXTENSION-POINTS §4 and the M1 plan said "never > deny > allow > unset". Read literally,
neither can express the most common forum setup: *hide this forum from everyone, but let
registered users (or one group) in*. With deny always beating allow, the "everyone: hidden"
grant would also shut out the group. phpBB2 avoided this with fixed levels (ALL / REG /
PRIVATE / MOD / ADMIN) per forum, plus `auth_access` rows that only ever widened access.

## Decision
A **grant** gives a **role** (capability → allow | deny | never; entries may be exact keys,
`prefix.*` or `*`, longest match wins) to a **subject** (everyone, guests, registered, a
group, a user), board-wide or on a node and its subtree. For capability C at node N:

1. **`never` is absolute.** Any matching grant in N's ancestry or board-wide whose role says
   `never` for C denies. It's used for bans and can't be overridden lower down.
2. **Nearest scope decides:** N itself, then its parent, …, then board-wide. The first scope
   with any matching grant that mentions C decides; farther scopes are not consulted.
3. **Within that scope, the most specific subject decides:** user > group >
   registered/guests > everyone. At equal specificity, **deny beats allow**.
4. **Nothing said means denied.**
5. **Capabilities declare requirements** (`topic.reply` requires `node.read`, which requires
   `node.view`), checked at the same node. "May reply where you can't read" can't happen.
6. **Global capabilities** (`admin.*`) consider only board-wide grants.

Every decision returns the grants that decided it (the **reason chain**), with the failed
requirement when that's why. `postmodem perms explain` prints it today; the ACP simulator
will show the same thing.

Pages use two answers: without `node.view` a forum doesn't exist for the viewer (absent from
lists, **404 identical to a missing id**); with `node.view` but not `node.read` it is listed
as restricted and its pages answer **403**. Nothing from an unreadable forum (last-post
titles, totals) is shown through a readable one.

Built-in roles (`core:reader`, `core:participant`, `core:moderator`, `core:admin`,
`core:hidden`, `core:read-only`, `core:no-read`, `core:banned`) are reinstalled on every
start, so upgrades can extend them. A board with no grants at all gets phpBB2's defaults:
everyone → reader, registered → participant.

## Consequences
- The phpBB2 importer (slice 6) maps per-forum `auth_*` levels to grants on that forum:
  ALL → everyone, REG → registered (plus everyone: hidden/no-read), PRIVATE → the
  `auth_access` groups (plus everyone: hidden), MOD/ADMIN → moderator/admin grants.
- Package policy contributors (EXTENSION-POINTS §4) run **after** this engine: they may deny
  or challenge, may widen only where the core said "unset", and never override `never`.
- The snapshot (all grants and roles) is loaded once per request. That's two small queries
  and fine for M1; a process-wide cache invalidated on grant changes comes with the admin
  panel, when grants can change at runtime.
- A property test checks the engine against a naive restatement of these rules on 3000
  random boards.
