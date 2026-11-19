# ADR 0022 — Self-hosted registration proof of work

- Status: accepted · records the decision shipped in 0.1.0

## Context

Public registration needs a lightweight abuse check that works without a third-party
service or a visual challenge. Registration must also work without JavaScript.

## Decision

The built-in registration check uses an expiring, server-signed proof-of-work challenge.
With JavaScript, the browser solves it in the background. Without JavaScript, the server
accepts a valid unused challenge once a short minimum wait has elapsed. Accepted
challenges are recorded to reject reuse.

Use the same registration check alongside the board's registration mode, invite policy
and other abuse controls. Guest posting can reuse the check when that feature is enabled.

## Consequences

Registration requires no external CAPTCHA requests. Proof of work adds computation on
the browser path. The fallback adds a time cost and can be automated, so registration
policy and rate limits remain relevant.
