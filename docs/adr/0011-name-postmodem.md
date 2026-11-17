# ADR 0011 — The project is called Postmodem

- Status: accepted · 2026-11-17

## Context
"osbb" was a working title. It couldn't stay: the GitHub organisation `osbb`
is taken, and ОСББ is a very common Ukrainian abbreviation (an association of
apartment-building co-owners), which would bury the project in search results.
The name must not use the "phpBB" trademark, and the project owner wanted a
nostalgic, retro-tech feel. About 80 candidates were checked against npm,
GitHub and the web.

## Decision
**Postmodem**: a pun on "postmodern", meaning what comes after the modem.
A forum package for the era after dial-up BBSes and phpBB2 boards.

| Identifier | Value |
|---|---|
| Product name | **Postmodem** |
| CLI | `postmodem` (e.g. `postmodem doctor`) |
| npm scope | `@postmodem` (e.g. `@postmodem/sdk`) |
| GitHub organisation | `postmodem-bbs` (the short `postmodem` is an existing personal account) |
| Container image | `ghcr.io/postmodem-bbs/postmodem` |
| Environment variables | `POSTMODEM_*` |
| Config file | `/data/postmodem.toml` |
| Extension manifest | `postmodem.extension.json` |
| Extension bundle | `.pmext` |
| Custom element / CSS variable prefix | `pm-` / `--pm-` |
| SDK handle in examples | `pm` |
| Webhook signature header | `X-Postmodem-Signature` |
| Domain | `postmodem.app` (preferred; appeared unregistered on 2026-11-17), `postmodem.io` as an alternative; schemas at `schemas.postmodem.app` |

Availability as checked on 2026-11-17: npm package free; GitHub
`postmodem-bbs` free; postmodem.org/.net/.com/.dev registered by others; no
software or forum product uses the name (an unrelated "Postmodem" podcast exists).

## To do (owner actions)
- Register `postmodem.app` (and optionally `postmodem.io`).
- Create the `postmodem-bbs` GitHub organisation and the `@postmodem` npm organisation.
- Optional: a trademark search in the jurisdictions that matter before the first public release.

## Consequences
- All docs use the new name and identifiers. The working directory and the
  spikes keep "osbb" in paths and internal names; they are throwaway or local.
- Retro flavour continues in the product where it's cheap (e.g. a "SysOp"
  label for admins in the Classic theme). The "doors" name for add-ons is
  noted as an idea, not adopted.
