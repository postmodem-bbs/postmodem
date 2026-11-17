# ADR 0005 — LiquidJS (strict) for add-on templates

- Status: accepted · 2026-11-17

## Context
Tier-1 add-ons render server-side so they work without JavaScript, and they
may come from untrusted authors. The template language must be logic-light,
impossible to escape into arbitrary code, familiar to hobbyists, and
well-maintained. Candidates were LiquidJS, Handlebars, and a minimal custom
language.

## Decision
LiquidJS in strict mode ([PLATFORM-SERVICES.md §9.2](../PLATFORM-SERVICES.md)):
- strict variables and filters (typos fail at install/preview, not silently);
- autoescaping on; `raw` output unavailable to tier 1;
- only core-provided filters and tags (`t`, `markup`, `date`, `relative`,
  `can`, `asset`, `user_link`, `avatar`, `counter`, `form`); add-ons cannot
  register their own in tier 1;
- template data limited to the slot context plus queries declared in the
  manifest;
- a render budget per slot (default 10 ms).

## Consequences
- Familiar syntax (Shopify/Jekyll), plenty of existing documentation.
- Tier-2 modules and themes still use Svelte components; Liquid is for tier 1
  only, so the core has two template systems. Accepted: they serve different
  trust levels.
- The LiquidJS version is pinned and fuzz-tested in CI against escape and
  denial-of-service templates.
