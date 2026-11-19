# ADR 0023 — Account deletion and post retention

- Status: accepted · records the decision shipped in 0.1.0

## Context

Members need to be able to export their data and delete their accounts. Board discussions
and moderation records may need to keep references to the original author ID.

## Decision

Offer a signed-in JSON export and require password confirmation for self-service
deletion. In a transaction, clear the profile and sign-in data, revoke sessions and
memberships, remove personal grants and watches, and remove the member's side of private
messages. Keep a tombstone account row and record the action in the audit log.

Keep posts under the board's deleted-user label by default. The
`core.accounts.deletedPosts` setting can remove them from public view instead. In that
case, update affected topic and forum counts. Clear the member's author association
from search in both modes.

## Consequences

Retained posts preserve discussion history, and references in audit records remain
resolvable. Post text can still contain identifying information, and the other participant
retains their own view of a private message. Package-owned data requires the
[privacy export and erasure extension point](../EXTENSION-POINTS.md), tracked in
[#43](https://github.com/postmodem-bbs/postmodem/issues/43).
