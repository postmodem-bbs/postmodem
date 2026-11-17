# ADR 0001 — Container-first delivery

- Status: accepted · 2026-11-17

## Context
Hobbyists self-host today on VPSes, home servers and NAS boxes running Docker, not on shared PHP hosting.

## Decision
Postmodem ships as one multi-arch OCI image that runs solo (`docker run`, SQLite, local disk) or as a Docker Compose stack (Postgres, cache, search, S3). The whole dev/CI/release process is built around that image. Details: [CONTAINERS.md](../CONTAINERS.md).

## Consequences
- Shared PHP hosting is out of scope.
- Every CI test runs against the image that ships.
- Infra config comes from env/files; never editable from the browser.
