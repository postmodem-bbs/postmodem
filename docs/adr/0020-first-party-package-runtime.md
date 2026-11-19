# ADR 0020 — First-party package runtime v0

- Status: accepted · records the decision shipped in 0.1.0

## Context

M2a needed quick reply, reports and unread tracking to extend the board through shared
contracts. [ADR 0019](0019-package-tiers-and-essentials-profile.md) defines the distribution
profiles and calls for each extension point to land with its first package.

## Decision

First-party packages ship with the board and declare their capabilities, default role grants,
settings and migrations through the core package API. The runtime exposes event handlers,
listing decorations and render slots. Packages supply structured slot data and the server
renders it with the board's accessibility and content security policy. Package routes check
enablement before serving requests.

The board's explicit enabled set takes precedence over the selected profile. Migrations
run for all installed packages and are tracked per package. Startup failures keep the
affected package inactive. Contribution failures are logged and the affected contribution
is skipped.

## Consequences

The board can enable packages without reinstalling them or dropping their tables when
they are disabled. In-process package code is trusted. Third-party extension contracts
and isolation follow the [two-tier extension design](0003-two-tier-extensions.md).
