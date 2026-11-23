<!--
Scope comes from the Postmodem roadmap Project:
https://github.com/orgs/postmodem-bbs/projects/2
Use the Project's own names for the milestone, epic and issues.
-->

## Scope

- **Milestone:** <!-- e.g. M2b — Platform v0 -->
- **Epic:** <!-- e.g. #29 M2b — Platform v0 -->
- **Issues:**
  - Closes #<!-- issues this PR completes -->
  - Refs #<!-- issues this PR advances without completing -->
- **Dependencies:** <!-- issues this unblocks, or blockers still open; "none" if none -->

## What changed

<!-- A short summary of the change and why. Link the plan section or ADR it follows. -->

## Checklist

- [ ] Every commit is signed off (`git commit -s`) and references its issue
- [ ] `pnpm check` passes
- [ ] `pnpm e2e` passes, if pages or flows changed
- [ ] Something visible changed? The demo board shows it (`demo-content.ts` + `e2e/demo-tour.spec.ts`, [CONTRIBUTING](../CONTRIBUTING.md#demo-board))
- [ ] Docs match the change (`docs/milestones/`, ADR if a decision was made or changed)
- [ ] The issues' Status on the Project is current
