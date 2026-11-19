# Contributing to Postmodem

Thanks for helping! A few ground rules keep the project healthy.

## Developer Certificate of Origin (DCO)

Every commit must be signed off, certifying that you wrote the change or have
the right to submit it under the project's licences
([developercertificate.org](https://developercertificate.org/)):

```bash
git commit -s -m "Describe the change"
```

This adds `Signed-off-by: Your Name <you@example.org>`. CI rejects pull
requests with commits that lack it. There is no CLA: you keep your copyright.

## Licences

| Path                        | Licence           |
| --------------------------- | ----------------- |
| everything not listed below | AGPL-3.0-or-later |
| `packages/sdk/**`           | Apache-2.0        |
| `docs/**`                   | CC-BY-4.0         |

Every source file starts with an SPDX header, for example:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
```

`pnpm check:spdx` verifies headers; `pnpm check:licenses` verifies that every
production dependency has a compatible licence. See
[ADR 0010](docs/adr/0010-agpl-core-apache-sdk.md).

## Before you open a pull request

```bash
pnpm check     # lint, typecheck, unit tests, SPDX headers, dependency licences
pnpm e2e       # end-to-end and accessibility tests (needs a running board)
```

Design decisions live in [`docs/`](docs/) and [`docs/adr/`](docs/adr/). If a
change contradicts an ADR, propose a new ADR first.

## Tracking work

Progress is tracked in the
[**Postmodem roadmap**](https://github.com/orgs/postmodem-bbs/projects/2)
GitHub Project. The
docs say *what* and *why*; the Project says *where it stands*.

- Each milestone (M0–M5) is a repository milestone with one `epic` issue. Its
  slices and packages are sub-issues of that epic.
- Plans come from [`docs/milestones/`](docs/milestones/). When a plan changes,
  update the doc and its issues in the same change.
- Status flows Backlog → Ready → In progress → In review → Done. Reference the
  issue in your commit or pull request (`Closes #31`) so it closes on merge.
- Pull requests list their scope as the Project lays it out (milestone, epic,
  issues closed or advanced, dependencies). The
  [pull request template](.github/pull_request_template.md) asks for it.
- Owner-only tasks carry the `owner-action` label. Open questions carry
  `decision`, and are settled in an ADR.
