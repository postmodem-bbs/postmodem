# ADR 0003 — Two-tier extension model

- Status: accepted · 2026-11-17

## Context
Przemo-era "mods" were patches to core files. Hobbyists wanted to add niche features quickly, while larger mods need full server access. A single SDK-only model would shut out the first group; an HTML/JS-only model would cripple the second.

## Decision
Two tiers on one platform (DESIGN.md §6):
- **Add-ons (tier 1):** manifest + HTML templates + JS/CSS, with no build step and no server code. They get server-side behaviour from capability-gated **platform services**: collections, realtime channels, settings, capabilities, outgoing webhooks. Safe to install from untrusted sources.
- **Modules (tier 2):** TypeScript packages using the full SDK, running in-process: hooks, routes, migrations, jobs, providers. Trusted only (a WASM sandbox comes later).
- Both share one package format, IDs and capabilities. An add-on can graduate to a module and migrate its data.
- **Dogfooding:** the shoutbox ships as a first-party *add-on*. If it can't be built in tier 1, the platform services have a gap.

## Amendment (2026-11-17): client JS trust
"Safe to install from untrusted sources" holds for server-side behaviour, which
the core enforces. It does not hold for JavaScript running on the board origin.
Tier 1 therefore has three modes ([PLATFORM-SERVICES.md §0](../PLATFORM-SERVICES.md)):
**declarative** (no JS, safe), **island** (JS in a sandboxed cross-origin iframe
behind a capability bridge, safe), and **inline** (JS on the board origin,
trusted add-ons only: first-party or explicitly trusted by an admin).

## Consequences
- Platform services (collections, channels) become core features that have to be designed, secured and rate-limited.
- Add-on templates use a safe, logic-less template language rendered on the server, so add-ons also work without JavaScript.
