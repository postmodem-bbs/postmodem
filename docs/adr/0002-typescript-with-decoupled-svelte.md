# ADR 0002 — TypeScript, with Svelte kept at the edge

- Status: accepted · 2026-11-17

## Context
Candidates were TypeScript/SvelteKit, Go + templ/htmx, PHP (Symfony/Laravel) and Elixir/Phoenix. With container delivery decided, Go's single-binary and PHP's shared-hosting advantages no longer apply. What matters is how easy extensions and themes are to write, how many people can contribute, and how the code ages. Forum software lives 15+ years, and JS framework churn is the main risk of a TypeScript stack.

## Decision
TypeScript end to end, on Node LTS. SvelteKit is the **web adapter only**:
- `packages/core` (domain, permissions, settings, use cases) is plain TypeScript with no framework, no HTTP and no DB driver imports. It talks to the outside world through ports (repositories, mailer, storage, clock, queue).
- `packages/sdk` (the extension API) does not depend on Svelte. UI extensions plug in as **Web Components** (custom elements). First-party UI may be written in Svelte and compiled to custom elements; third parties can use vanilla JS, Lit or anything else.
- `apps/web` (SvelteKit, adapter-node) maps routes and form actions to core use cases and renders the HTML.
- A dependency-cruiser rule in CI forbids `svelte`/`@sveltejs/*` imports outside `apps/web`, `packages/ui` and themes.

## Consequences
- Svelte can be replaced (e.g. Hono + server templates) without touching domain logic or third-party extensions.
- Theme template overrides remain Svelte-coupled. That is accepted; token-and-CSS-only themes are not.
- Resource budget is soft (see DESIGN.md §5.1): aim small, don't contort the code for a Raspberry Pi.
