# Contributing to Postmodem

Thanks for helping! A few ground rules keep the project healthy.

## Developer Certificate of Origin (DCO)

Every commit must be signed off, certifying that you wrote the change or have
the right to submit it under the project's licences
([developercertificate.org](https://developercertificate.org/)):

```bash
git commit -s -m "Describe the change"
```

This adds `Signed-off-by: Your Name <you@example.org>`, which must match the
commit's author. There is no CLA: you keep your copyright.

The sign-off is checked at every step, by one script
([`scripts/dco.mjs`](scripts/dco.mjs)):

- `pnpm install` turns on the repository's git hooks (`core.hooksPath`
  `.githooks`). In an existing clone, run `pnpm run prepare` once.
- The `commit-msg` hook refuses an unsigned commit. The `pre-push` hook refuses
  to push unsigned commits, including rebased or cherry-picked ones.
- The `dco` CI job fails the pull request, and the main guard flags any commit
  on `main` without a sign-off.
- Commits made in GitHub's web interface require a sign-off (a repository
  setting).

Forgot it? `git rebase --signoff origin/main && git push --force-with-lease`.
`pnpm check:dco` checks your branch before you push.

**Coding agents** follow [AGENTS.md](AGENTS.md). An agent commits under, and
signs off as, the person it works for. It never bypasses the hooks or signs off
for anyone else. If you let an agent commit for you, its sign-off is your
certification.

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
docs say _what_ and _why_; the Project says _where it stands_.

- Each milestone (M0–M5, with M2a–M2c, and Beta) is a repository milestone with one `epic` issue. Its
  slices and packages are sub-issues of that epic.
- Plans come from [`docs/milestones/`](docs/milestones/). When a plan changes,
  update the doc and its issues in the same change.
- Status flows Backlog → Ready → In progress → In review → Done. Reference the
  issue in your commit or pull request (`Closes #31`) so it closes on merge.
- Pull requests list their scope as the Project lays it out (milestone, epic,
  issues closed or advanced, dependencies). The
  [pull request template](.github/pull_request_template.md) asks for it.
- Feature issues say which side of [ADR 0004](docs/adr/0004-core-is-vanilla-phpbb2.md) they
  are on: `scope: vanilla` for what vanilla phpBB2 had (core, in every profile), and
  `scope: przemo` for what Przemo added (a package). Platform, ops and theming work takes
  neither.
- Owner-only tasks carry the `owner-action` label. Open questions carry
  `decision`, and are settled in an ADR.

## Branch rules

`main` is always releasable: every change reaches it through a pull request
that passed CI, and its history is never rewritten.

- **Pull requests only.** No direct pushes to `main`, no force-pushes, no
  deleting it. Pull requests land through the **merge queue**, squashed, so
  `main` stays linear and each commit names its pull request (`… (#75)`).
- **Merge queue.** When a pull request is ready, choose "Merge when ready" (or
  run `gh pr merge <n> --auto`). The queue tests it on top of `main` and of the
  pull requests queued ahead of it, then merges it. Nobody needs to update a
  branch by hand. A pull request whose group fails leaves the queue and stays
  open.
- **Required checks:** `Lint, typecheck, unit tests, licences`, `Build image`,
  `E2E` and `dco`, on the pull request and again on its merge-queue group.
  `E2E` passes only when every e2e job passed. There is one job per board and
  browser (`E2E + accessibility (vanilla, webkit)` and so on), so a failing
  browser shows on its own and can be re-run alone.
- **Where CI runs what:** a pull request runs the checks, an amd64 image and a
  few e2e jobs (solo, stack and vanilla on Chromium) for quick feedback. Its
  merge-queue group runs the whole matrix against the multi-arch image it
  pushes as `sha-<sha>`, so Firefox, WebKit and theme failures can first show
  up there. The push to `main` builds and tests nothing: the queue already
  tested that commit, and the push only re-tags its image as `:edge`.
- **Code scanning:** CodeQL (GitHub's default setup) must have analysed the
  pull request, and the pull request must not introduce a high or critical
  security alert, or an error-level alert. Fix the alert, or have a maintainer
  dismiss it with a reason when it's a false positive.
- **Reviews:** review threads must be resolved. While the project has one maintainer, no approving
  review is required; raise `required_approving_review_count` in the ruleset
  when that changes.
- **Release tags** (`v*`) are created once and never moved or deleted.
- **Emergencies:** an administrator may merge a pull request whose checks
  can't pass (a broken runner, say), still through the pull request. Say why in
  the pull request.

The rules are code, in [`.github/rulesets/`](.github/rulesets/). An
administrator applies a change to them with:

```bash
node scripts/rulesets.mjs apply
```

and `node scripts/rulesets.mjs check` compares GitHub with the files. The
**Main guard** workflow runs that check weekly and when the files change, and on
every push to `main` it fails if a commit got there without a merged pull
request or if `main` was force-pushed.

GitHub only enforces rulesets for public repositories or on a paid plan. Until
then the rules above hold by convention: the Main guard workflow reports a
breach after the fact, and the check prints a warning instead of failing. Turn
on the local hook that refuses pushes to `main` from your clone:

```bash
git config core.hooksPath .githooks
```
