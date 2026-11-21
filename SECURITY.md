# Security policy

Postmodem is forum software: it stores accounts, passwords, private messages and e-mail
addresses for the people on a board. Security reports are welcome and taken seriously,
even though the project is still an early preview.

## Reporting a vulnerability

**Please don't open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub:
[Security → Report a vulnerability](https://github.com/postmodem-bbs/postmodem/security/advisories/new).
Only the maintainers see the report, and it is the place to work on a fix and an advisory
together.

A useful report says:

- which version or image (`postmodem config print` or the image tag) and which deployment
  (solo or stack, SQLite or Postgres);
- what an attacker can do, and what they need first (an account, a moderator role, network
  access);
- the steps or a proof of concept that shows it.

## What to expect

- An acknowledgement within **7 days**.
- An assessment and a planned fix, or a reasoned "not a vulnerability", within **30 days**.
- Credit in the advisory and the release notes, unless you'd rather stay anonymous.

Postmodem is run by volunteers, so these are targets, not guarantees. Please give us a
reasonable time to release a fix before you disclose the problem publicly. 90 days is the
default, and we'll agree on a date with you.

## Supported versions

Until 1.0, only the latest release gets security fixes.

| Version                               | Supported |
| ------------------------------------- | --------- |
| latest 0.x release (currently 0.1.x)  | yes       |
| `edge` (latest tested build of main)  | yes       |
| older releases                        | no        |

## Scope

In scope: the Postmodem image and code in this repository, the deployment files in
`deploy/`, and first-party packages.

Out of scope: boards that other people run (report those to whoever runs them),
vulnerabilities that need an administrator account to exploit (administrators are trusted
with the whole board), and denial of service by sheer traffic volume.
