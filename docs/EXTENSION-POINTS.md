# Postmodem — core extension points (SDK v1 contract)

Status: **draft** · 2026-11-17 · derived from [PACKAGES.md §3](PACKAGES.md) ·
builds on [DESIGN.md §6](DESIGN.md)

This is the contract between the core and every tier-2 module, and the
foundation the tier-1 platform services are built on. If a Przemo package in
PACKAGES.md can't be written against this document without touching the core,
the document is wrong.

Code is illustrative TypeScript: names and shapes, not final signatures.

---

## 1. Model

### 1.1 The command pipeline

Every state change in the core (create post, move topic, log in, register…) is
a **command** that goes through the same pipeline. Most extension points are
stages of it:

```
 request ──► policy ──► before-filters ──► persist ──► in-tx hooks ──► commit ──► events (outbox)
  (ctx)      (§4)        (§3: may modify,   (core)      (§3: write      │          (§8: async,
                          veto, redirect)               side tables     │           retried)
                                                        atomically)     └─► realtime channels
```

- **policy** decides whether the actor may do it (§4–5).
- **before-filters** may change the draft, veto it with a typed error, or
  *redirect* it to a different command (once).
- **in-transaction hooks** let packages write their own side tables atomically
  with the core change (revisions, ip-logging). They cannot veto.
- **events** are written to an outbox in the same transaction and delivered
  after commit, at least once. Handlers must be idempotent.

Reads have their own pipeline: **query → visibility (§2) → view model
decorators (§6) → render (§7)**.

### 1.2 Registration

```ts
export default defineModule({
  id: 'revisions',                       // globally unique, kebab-case
  engine: '^1.0.0',                      // @postmodem/sdk range
  register(pm) {
    pm.filters.on('post.beforeUpdate', captureOldBody, { priority: 100 });
    pm.tx.on('post.updated', writeRevision);
    pm.capabilities.define('revisions.view', { default: ['moderator'] });
    pm.privacy.handles({ export: exportRevisions, erase: eraseRevisions });
    pm.importer.slice(przemoSlice);
  },
});
```

All IDs are namespaced by package (`revisions:…`). The core uses the reserved
namespace `core`.

### 1.3 Cross-cutting rules (apply to every extension point)

| Rule | Detail |
|---|---|
| **Batch-first** | Every hook that runs per item on a read path receives a **batch** (all topics on the page, all posts in the view). No per-item hooks on read paths, so N+1 queries are impossible by design |
| **Ordering** | `priority` (number, lower runs first) plus optional `before: [pkg]` / `after: [pkg]`. Cycles fail at boot with a clear error |
| **Criticality** | Each sync hook declares `critical: true` (security; failure **fails closed** = the command is denied) or `false` (decorative; failure **fails open** = hook skipped and logged). Security-relevant points default to `critical` |
| **Budgets** | Sync hooks get a time budget (default 50 ms per batch). Overruns are logged with the package name; repeated failures trip a **circuit breaker** that disables the package and notifies admins |
| **Isolation of data** | Packages write only their own tables (`ext_<id>_*`), entity fields, collections or counters. Core tables are read-only to packages and changed only through commands |
| **Observability** | Every hook invocation is traced (OTel span `ext.<id>.<point>`) and metered per package |
| **Determinism** | Filters must not depend on wall-clock or randomness beyond `ctx.clock` / `ctx.random` (fakeable in tests) |
| **Versioning** | Each point is part of `@postmodem/sdk` semver. Breaking changes need a major version; deprecations live for at least one minor with runtime warnings |

---

## 2. Visibility

PACKAGES.md listed one "visibility predicates" point. Working through the
packages split it in two, because "is this post in the trash?" and
"has *this reader* ignored its author?" behave differently: the first changes
counts, search and feeds for everyone, the second only one reader's view.

### 2.1 Visibility states (stored, global) — EP-1a

Posts and topics carry a single **`visibility`** value. Packages register states:

```ts
pm.visibility.defineState('premoderation:pending', {
  appliesTo: ['post', 'topic'],
  visibleTo: ['author', 'cap:premoderation.review'],   // who can still see it
  counts: false,                                      // excluded from forum/topic/user counts
  searchable: false, feeds: false, federate: false,
  label: 'premoderation.state.pending',               // i18n key for staff badges
});
```

| State | Registered by |
|---|---|
| `core:public`, `core:deleted` | core |
| `premoderation:pending`, `premoderation:rejected` | premoderation |
| `trash-bin:trashed` | trash-bin |
| `expiry:expired` | expiry |
| `author-delete:tombstone` (visible to all as a placeholder, no body) | author-delete |

Consequences:

- Counts (vanilla's denormalised `forum_posts`, `topic_replies`, user post
  count) are maintained by the core using the states' `counts` flag, so there
  are no per-reader counts and no expensive recounts.
- Search, feeds and federation exclude non-`searchable` / `feeds` / `federate`
  states automatically, so packages can't forget.
- State transitions are commands (`post.setVisibility`) with policy, filters
  and events like everything else.
- **Unregistered states fail closed.** If the package that registered a state
  is disabled or uninstalled, content in that state is hidden from everyone
  but admins, excluded from counts, search, feeds and federation, and listed in
  the ACP for the admin to resolve (re-enable, move to `core:public`, or purge).
  This is what makes disabling any package safe and reversible
  ([ADR 0009](adr/0009-federation-optional-module.md)).
- **Authors can be remote.** `post.author` and `topic.author` may reference a
  remote actor (`origin != local`, no login, `remote` role). Every extension
  point that receives an author must handle that; the SDK's test kit includes
  remote authors in its fixtures.

### 2.2 Reader filters (per reader, query-time) — EP-1b

For things that depend on who is reading: ignored users and topics, and
forum-password locks on listings.

```ts
pm.visibility.readerFilter('ignore-topics:hide', {
  appliesTo: ['topicList'],
  // returns a predicate in the portable predicate AST, not raw SQL
  predicate: async (viewer) => viewer.isGuest ? null
    : not(inSet('topic.id', await ignoredTopicIds(viewer.id))),
  mode: 'exclude' | 'collapse',        // collapse = row stays, rendered as "hidden (show)"
});
```

The **predicate AST** (`eq`, `inSet`, `and`, `or`, `not`, `exists(sideTable…)`)
compiles to SQLite SQL, Postgres SQL **and** search-engine filters, so the
same rule applies to listings and to search results. Raw SQL fragments are not
allowed: they would break the dialect split and Meilisearch.

Reader filters never affect counts; that's why "5 replies" can show next to
4 visible ones for someone who ignores a poster (as in Przemo).

---

## 3. Command lifecycle — EP-3

### 3.1 Before-filters

```ts
pm.filters.on('post.beforeCreate', async (draft, ctx) => {
  const prev = await ctx.read.lastPostInTopic(draft.topicId);
  if (prev?.authorId === ctx.actor.id && within(prev.createdAt, mergeWindow(ctx)))
    return ctx.redirect('post.append', { postId: prev.id, body: draft.body });
  return draft;                         // or a modified copy, or ctx.veto('code', params)
}, { priority: 500 });
```

| Outcome | Meaning |
|---|---|
| return draft (maybe modified) | continue to the next filter |
| `ctx.veto(code, params)` | stop; typed, translatable error to the user |
| `ctx.redirect(command, input)` | replace this command with another (allowed once per pipeline, and the new command runs its own full pipeline) |
| `ctx.defer(state)` | persist, but with a non-public visibility state (premoderation) |

Commands with before-filters in v1: `post.create/update/delete/append/move`,
`topic.create/update/move/lock/unlock/split/merge/delete`,
`user.register/update/delete`, `pm.send`, `poll.vote`, `node.*`, `group.join/leave`.

Drafts are **typed and immutable**: filters return a new object. A filter may
only change fields it declared in `writes: ['body', 'fields.post-icons:icon']`;
the core rejects undeclared changes. This keeps "who changed my post?" answerable.

### 3.2 In-transaction hooks

```ts
pm.tx.on('post.updated', async ({ before, after }, tx) => {
  await tx.table(revisions).insert({ postId: after.id, body: before.body, editorId: tx.actor.id });
});
```

Run inside the command's DB transaction. They can't veto; throwing aborts the
whole command (so they're always `critical`). Use sparingly. Most things
belong in events.

### 3.3 Delete interception

Delete is just a command with before-filters: `trash-bin` redirects
`post.delete`/`topic.delete` to `topic.move` (to the trash forum) and
`author-delete` turns an author's own delete into `post.setVisibility(tombstone)`.
Hard delete stays available to the `core:purge` capability and is what GDPR
erasure uses (§11).

---

## 4. Policy (access) — EP-5

All authorisation goes through one engine:

```ts
const decision = await pm.policy.check(viewer, 'post.edit', post);
// → { allowed: false, reason: { pkg: 'edit-policy', code: 'window_closed', params: { minutes: 15 } } }
```

Packages add **policy contributors**:

```ts
pm.policy.contribute('post.edit', async (viewer, post, ctx) => {
  if (post.author.isAdmin && !viewer.isAdmin) return deny('protected_admin_post');
  if (ctx.now - post.createdAt > editWindow(viewer)) return deny('window_closed');
  return abstain();
}, { critical: true });
```

- Resolution: core grants (roles × scopes, DESIGN §5.3) first; then any
  contributor `deny` wins; `allow` from a contributor can only *widen* where the
  core said "unset", never override a core `never`.
- Every decision carries a **reason chain**, which the ACP permission simulator
  ("why can't X do Y here?") shows verbatim.
- **Challenges**: a contributor can return `challenge('forum-password:unlock', …)`
  instead of deny. The web layer renders the challenge form (password prompt) and
  retries. This covers `forum-password`.
- Non-boolean policies use the same engine: `post.countsTowardRank`
  (no-count-forums), `user.rank` (ranks-plus resolves the displayed rank,
  first non-abstain by priority).

Policy checks are batched on read paths: `checkMany(viewer, 'topic.read', topics)`.

---

## 5. Authentication — EP-6

A specialisation of policy plus lifecycle hooks, separate because it runs
before there is a viewer:

| Hook | Kind | Used by |
|---|---|---|
| `auth.beforeLogin(identifier, ctx)` | veto/delay (e.g. lockout, backoff) | login-security |
| `auth.afterLoginFailure` / `afterLoginSuccess` | event (sync counter update) | login-security, ip-logging |
| `auth.passwordPolicy(password, user)` | validator returning issues | login-security |
| `session.validate(session, ctx)` | critical check on every request, **must be O(1)** from cached session data | login-security (IP binding), bans-plus, warnings (deny-posting is policy, full ban is session) |
| `ban.check(subject)` | contributor to the core ban list (expiry, host bans) | bans-plus |
| `auth.providers` | registry (§9) | OIDC, passkeys |

`session.validate` runs on every request, so contributors must declare the
session fields they need. The core caches them with the session and
invalidates them on relevant events (ban created, warning threshold reached).

---

## 6. View models: listings, topics, decorations — EP-2, EP-10

Pages are built from **view models**: plain data the theme renders. Packages
change the view model, not the HTML.

### 6.1 Listing modifiers

```ts
pm.listings.sortKey('listing-options:locked-last', {
  appliesTo: 'topicList',
  expr: [desc('topic.isLocked', { nullsLast: true })],     // predicate-AST sort expression
});
pm.listings.group('listing-options:separate-announcements', { by: 'topic.type', order: ['core:announcement', '*'] });
pm.listings.inject('global-announcements:inject', {
  appliesTo: 'topicList', position: 'top',
  rows: async (forum, viewer) => globalAnnouncementsFor(forum, viewer),
});
```

Sort keys and grouping are **declarative** (they go into the query, so they
work with pagination) and so are available to tier-1 add-ons through the
manifest. `inject` is tier-2 only.

### 6.2 Decorators (batch)

```ts
pm.views.decorate('topicList', async (rows, viewer) =>
  rows.map(r => ({ ...r, ext: { 'unread-tracking': { unread: unreadMap.get(r.id) } } })));
```

Decorations go under `ext.<pkg>` in the view model, so packages can't collide.
Themes and slots read them. Entity-field values are decorated automatically.

### 6.3 Alternate topic renderers — EP-10

```ts
pm.views.topicMode('threaded-view:tree', {
  label: 'threaded-view.mode', available: (forum) => forum.fields['threaded-view:enabled'],
  load: async (topic, page, viewer) => loadTree(topic, page),   // returns a TopicView with nested posts
  component: 'pm-threaded-topic',                             // custom element (or theme override)
});
```

The mode is chosen by forum setting and user preference. The view model shape
is shared, so other decorators (unread, helpful, ignore) keep working in every mode.

---

## 7. Rendering content — EP-4

### 7.1 Pipeline

```
source (BBCode/Markdown) ─parse─► AST ─transform (invariant)─► AST ─serialise─► HTML with holes ─resolve holes (per reader)─► HTML
                                                                        ▲ cached by (post id, content version, renderer version)
```

- **Markup plugins** (tier 1 declarative tags, tier 2 full AST access) take
  part in parse/transform. Their output depends only on the content, so it's
  cached once for everyone.
- **Reader-dependent content** becomes a **hole**: a placeholder node with a
  resolver key. Holes are resolved per request, in a batch, after the cache.

```ts
pm.render.hole('hide-until-reply:hidden', {
  vary: ['topic.viewerHasReplied'],          // reader facts the resolver needs, batched per page
  resolve: (node, facts) => facts['topic.viewerHasReplied'] || facts.can('hide.bypass')
    ? node.children : placeholder('hide-until-reply.locked'),
  outside: 'placeholder',                    // feeds, search snippets, federation, email: always the placeholder
});
```

This replaces the earlier "cache × variation flags" idea: the expensive part
(parsing, sanitising) is shared, and per-reader work is limited to the few
holes. `censor-bypass` uses the same mechanism (censored words become holes
when the reader has `censor.bypass`; otherwise the censor runs at transform time).

- **Post-level** reader effects (ignore-users collapsing a whole post) are
  *not* render hooks. They're view-model decorations (§6.2) with
  `collapse` mode, so the cached HTML is untouched.
- **Sanitisation is last and is core**: plugins can't emit raw HTML except
  through `html-markup`, which widens the sanitiser's allow-list by capability.
  The sanitiser still runs.

### 7.2 Outside contexts

Every hole and plugin declares how it renders in **outside contexts**: `feed`,
`email`, `federation`, `searchSnippet`, `plainText`. The default is the
placeholder, so a new package doesn't leak content by accident.

---

## 8. Events — EP-9 (+ moderation events)

```ts
pm.events.on('topic.moved', async (e) => { … }, { retry: { attempts: 8, backoff: 'exp' } });
```

- At-least-once delivery from the transactional outbox, processed by the
  `worker` role; ordered **per aggregate** (per topic, per user), not globally.
- Every event carries `actor`, `occurredAt`, `requestContext` (§10),
  `correlationId`, and for moderation events `reason` (free text + reason code)
  and `silent` (the actor chose not to notify; needs a capability).
- **Moderation event family**: `topic.locked/unlocked/moved/split/merged`,
  `post.visibilityChanged`, `user.warned`, `user.banned`, `report.resolved`…
  `topic-timeline`, `mod-notices`, `notifications` and webhooks all subscribe
  to the same events.
- Public events (a documented subset) are what tier-1 add-ons see through
  channels and what outgoing webhooks deliver.

---

## 9. Registries — EP-7

All registries share one shape (`pm.<registry>.define(id, spec)`), are
frozen after boot, and are introspectable in the ACP ("what does this package
add?").

| Registry | Spec highlights | Used by |
|---|---|---|
| `capabilities` | default roles, scope (`global`/`node`), dangerous flag | everyone |
| `nodeKinds` | storage fields, listing renderer, routing (`link-forums` → redirect + counter) | link-forums |
| `topicTypes` | precedence, scope (`node`/`global`), capability to create, listing placement | global-announcements |
| `visibilityStates` | §2.1 | premoderation, trash-bin, expiry, author-delete |
| `entityFields` | DESIGN §6.2 | many |
| `topicModes` | §6.3 | threaded-view |
| `notifiers` | channel id, user settings schema, `send(batch)` | notifier-* |
| `providers.storage/search/captcha/auth/av` | interface implementations with health checks | infra adapters |
| `jobs` / `schedules` | idempotent handlers, cron spec, concurrency | expiry, groups-plus, stats… |
| `routes` | under `/x/<pkg>/…`, plus ACP pages under `/acp/x/<pkg>` | tier 2 |
| `slots` | component or template per slot (DESIGN §6.2) | both tiers |
| `themeAssets` | named asset sets (post icons, rank images) resolved per theme | post-icons, ranks-plus |

---

## 10. Request context & personal data — EP-8

```ts
interface RequestContext {
  ip: Personal<string>;            // Personal<T> = value + classification + retention policy
  userAgent: Personal<string>;
  locale: string; timezone: string;
  sessionId?: string; via: 'web' | 'api' | 'federation' | 'cli' | 'job';
}
```

- `Personal<T>` values are **readable only by packages that declare them** in
  the manifest (`personalData: { reads: ['ip', 'userAgent'], purpose: '…', retentionDays: 90 }`).
  The ACP shows these declarations, and they feed the board's privacy page.
- Stored personal data must go through `pm.privacy` (§11).
- Behind trusted proxies (`POSTMODEM_TRUSTED_PROXIES`) the core resolves the real
  client IP. Packages never parse headers themselves.

## 11. Privacy hooks — EP-13 *(new)*

Not in PACKAGES.md §3, but forced by the per-package data split: once data is
scattered across 45 modules, GDPR export and erasure must be extension points
too, or they'll be incomplete.

```ts
pm.privacy.handles({
  export: async (userId) => ({ 'revisions': await listRevisionsBy(userId) }),
  erase:  async (userId, mode /* 'anonymise' | 'delete' */) => { … },
  retention: { job: 'revisions:prune', setting: 'revisions.keepDays' },
});
```

The core refuses to enable a package that declares personal data but provides
no `export`/`erase` handlers.

## 12. Search contributions — EP-11

```ts
pm.search.document('topic', {
  fields: { 'topic-subtitle:subtitle': { type: 'text', weight: 0.6 } },   // entity fields marked searchable add this automatically
  extract: async (topics) => …,                                            // batch
});
pm.search.filter('seeker:author-since', { params: { userId: 'id', since: 'date' }, predicate: (p) => and(eq('post.authorId', p.userId), gte('post.createdAt', p.since)) });
```

- Filters use the predicate AST (§2.2), so they work on DB FTS and Meilisearch.
- Visibility states and reader filters apply to search automatically.
- Reindexing is a job; packages that change what they contribute bump a
  `searchSchemaVersion`, which schedules a background reindex.

## 13. Importer slices — EP-12

```ts
pm.importer.slice({
  source: 'przemo-1.12',
  dependsOn: ['core'],                         // order between slices
  reads: { tables: ['posts_text_history'], columns: { posts: ['post_edit_by'] }, config: ['ph_days', 'ph_len'] },
  run: async (src, ids, sink) => {
    for await (const row of src.rows('posts_text_history', { batch: 1000 })) {
      await sink.insert(revisions, { postId: ids.map('post', row.post_id), body: src.text(row.post_text) /* ISO-8859-2 → UTF-8, BBCode uid stripped */ });
    }
  },
});
```

- `ids` is the shared legacy-ID → new-ID map that core writes and slices read.
- Slices are **idempotent and resumable** (checkpoint per batch), so a 2 GB
  board import can be interrupted.
- After an import, the importer reports any legacy tables, columns or config
  keys that no enabled slice read, checked against the uninstaller's list, so
  nothing is dropped silently.

---

## 14. Tier-1 access

Tier-1 add-ons don't touch these points directly. The platform services expose
safe, declarative subsets:

| Extension point | Tier-1 surface |
|---|---|
| Visibility states / reader filters | — (tier 2 only) |
| Command filters | — (but collection writes have their own declarative validation and rate limits) |
| Policy | capabilities declared in the manifest; collection access rules |
| Listing modifiers | declarative sort keys and grouping on entity fields |
| Decorators | entity-field values appear in view models automatically |
| Rendering | declarative markup tags; no holes |
| Events | public events via channels; outgoing webhooks |
| Registries | capabilities, entity fields, slots, theme assets, settings, preferences |
| Privacy | collections declare `personal: true` fields; the core then handles export/erase automatically |
| Importer | — |

## 15. Testing kit

`@postmodem/sdk/testing` ships a harness that boots the real core in memory (SQLite
`:memory:`, in-process counters and channels, fake clock):

```ts
const board = await testBoard({ packages: ['post-merge'], profile: 'vanilla' });
const u = await board.users.create();
await board.as(u).post.create({ topicId, body: 'a' });
await board.clock.advance('5m');
await board.as(u).post.create({ topicId, body: 'b' });
expect(await board.topic(topicId).posts()).toHaveLength(1);   // merged
```

Contract tests for each extension point are shipped as well. The core's own
test suite runs every first-party package against them, which is how we find out
when the SDK contract and the packages disagree.

---

## 16. Coverage check against PACKAGES.md

| Package | Extension points used |
|---|---|
| premoderation | visibilityStates · lifecycle (`defer`) · policy · events · slots |
| trash-bin | visibilityStates · lifecycle (redirect delete) · entityFields (forum marked as trash) |
| expiry | visibilityStates · entityFields · schedules |
| post-merge | lifecycle (redirect) · in-tx hook |
| revisions | lifecycle · in-tx hook · policy · privacy · importer |
| edit-policy | policy |
| forum-password | policy (challenge) · reader filters · routes |
| global-announcements | topicTypes · listing inject · capabilities |
| threaded-view | topicModes · entityFields · lifecycle (reply-to) |
| hide-until-reply | render holes · outside contexts |
| ignore-users / ignore-topics | reader filters · decorators (collapse) · privacy |
| unread-tracking | counters · decorators · events · privacy |
| login-security | auth hooks · session.validate · counters |
| attachments | providers.storage/av · lifecycle · policy · jobs · privacy · importer |
| topic-viewers | counters · events · policy · audit log · privacy |
| stats | schedules · read API (§6 view models) |

Every package in PACKAGES.md §2 maps onto points defined here. If one stops
fitting, the fix goes here, not into the core.

## 17. Open questions

1. **Predicate AST expressiveness**: `exists` over side tables is needed
   (ignore-users); how far do we go (joins, aggregates)? Proposal: `exists`
   only, no aggregates, in v1.
2. **Redirect depth**: one redirect per pipeline is enough for every package
   known today; keep it strict.
3. **Tier-2 sandboxing later (WASM)**: in-tx hooks and predicate builders must
   remain serialisable/async-safe so they can cross a WASM boundary. Avoid
   passing live DB handles in v1 APIs where a data request would do.
4. **Hot enable/disable without restart**: possible for tier 1; for tier 2
   probably "takes effect at next restart" in v1 (the registries are frozen at boot).
