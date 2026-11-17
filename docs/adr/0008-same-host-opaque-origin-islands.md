# ADR 0008 — Add-on islands on the same host, isolated by an opaque origin

- Status: accepted · 2026-11-17

## Context
Untrusted tier-1 add-on JavaScript runs in "islands" (PLATFORM-SERVICES §0)
so it can't act as the logged-in reader. The original plan gave islands a
**separate origin**: a second port (8081) in solo mode and an `islands.`
subdomain in the stack. That means extra ports, extra DNS/TLS, proxy rules and
configuration that has to be right in every deployment. The alternative is to
serve islands from the board's own host and let the browser give them an
**opaque origin**.

Guiding preference (from the project owner): pick whichever is easiest to
implement, test and maintain.

## Decision
Islands are served by the board itself at `/x/<addon>/island/…`, with three
layers of isolation:

1. the iframe has `sandbox="allow-scripts"` (no `allow-same-origin`,
   `allow-top-navigation`, `allow-popups`, `allow-forms`), so its origin is `null`;
2. the island response carries `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; connect-src 'none'; …`,
   so it's sandboxed **even when opened directly**, not just when framed,
   and it can't make any network request at all: everything goes through the
   `postMessage` bridge;
3. the session cookie is `__Host-`, `HttpOnly`, `SameSite=Lax`, and the API
   rejects requests with `Origin: null`.

Island HTML must be **static and not personalised** (the frame request itself
carries the reader's cookies, as any same-host navigation does). All
reader-specific data reaches the island through the bridge, filtered by the
reader's capabilities.

## Evidence
Spike [spikes/island-origin](../../spikes/island-origin/) in headless Chrome:
origin `null`; `document.cookie`, `localStorage`, parent DOM and top
navigation all throw `SecurityError`; `fetch('/api/me')` never reached the
server; an exfiltration image to an external host was blocked by CSP; the
bridge worked in both directions. Firefox and WebKit not yet verified; CI
runs the same check on Playwright's Chromium, Firefox and WebKit builds.

## Consequences
- No second port, no `islands.` subdomain, no `POSTMODEM_ISLAND_ORIGIN` setting:
  solo mode stays a single port and a single `docker run`.
- One code path for solo and stack, testable with one Playwright test.
- Islands can't use `localStorage`/cookies; add-ons use preferences or
  collections through the bridge instead (which is the intended API anyway).
- Relies on browser sandbox correctness, which modern browsers (and CSP
  `sandbox`) have supported for years. If a serious bypass ever appears, a
  separate-origin mode can be added as an opt-in without changing add-ons,
  because they only ever talk to the bridge.
