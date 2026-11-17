# Postmodem — container-first development & delivery

Status: **draft for discussion** · 2026-11-17 · companion to [DESIGN.md](DESIGN.md)

The end product is **one OCI image** that runs either alone or as part of a
Docker Compose stack. This document designs the whole lifecycle — local dev,
testing, CI, release, operations — around that image from day one, so that
"works on my machine" and "works in production" are the same claim.

Stack: TypeScript on Node LTS, with SvelteKit as the web adapter
([ADR 0002](adr/0002-typescript-with-decoupled-svelte.md)).

---

## 1. Ground rules

1. **One image, many roles.** The same image is the web server, the background
   worker, the scheduler, the migration runner and the admin CLI. Role is chosen
   by command, never by a different build.
2. **Build once, promote the digest.** CI builds the image a single time; every
   test stage runs *that* image; release just re-tags the tested digest.
3. **Two deployment shapes, one config model.**
   - **Solo**: `docker run` one container, SQLite + local disk, everything
     in-process. For the hobbyist with a Raspberry Pi or a €4 VPS.
   - **Stack**: Compose with Postgres, Valkey, Meilisearch, S3-compatible
     storage, a reverse proxy, separate web/worker replicas.
   Moving from solo to stack is a config change plus `postmodem migrate-data`, not a
   reinstall.
4. **All state lives in `/data` or in external services.** The container
   filesystem is read-only; the image is disposable.
5. **Configuration is environment-first** (12-factor), with an optional
   mounted file for people who prefer one. Secrets accept `*_FILE` variants for
   Docker/Compose secrets.
6. **Nothing in the runtime image can compile code.** No npm, no compilers, no
   shell needed. Extensions and themes arrive as prebuilt bundles.
7. **Dev happens in containers too** — but with fast feedback (watch/sync, hot
   reload), not rebuild-per-change.

## 2. The image

### 2.1 Contents & properties

| Property | Decision |
|---|---|
| Base | Distroless / Wolfi Node 24 runtime (no shell) for `latest`; a `-debug` variant with busybox for troubleshooting |
| User | Non-root, fixed UID/GID `10001`; works under rootless Docker and Podman |
| Filesystem | Read-only root; writable `/data` (volume) and `/tmp` (tmpfs) |
| Ports | `8080` HTTP only — TLS terminates at the proxy (or Caddy in the stack). Add-on islands are served on the same port (ADR 0008) |
| Architectures | `linux/amd64`, `linux/arm64` (Raspberry Pi, Ampere, Apple silicon) |
| Entrypoint | `Postmodem` CLI (tini-style PID 1 signal handling built in) |
| Default command | `postmodem run` = web + worker + scheduler in one process (solo mode) |
| Health | `GET /healthz` (liveness), `GET /readyz` (DB reachable, migrations current); `postmodem healthcheck` for `HEALTHCHECK` without curl |
| Shutdown | Graceful on SIGTERM: stop accepting, drain requests, finish/requeue jobs, ≤ 25 s |
| Logs | JSON to stdout (pretty in dev); no log files |
| Metrics/traces | `/metrics` (Prometheus) on a separate port `9090`, OpenTelemetry export opt-in |
| Supply chain | SBOM (SPDX) + provenance attestations, cosign keyless signature, Renovate-pinned base digests |
| Licence metadata | OCI labels `org.opencontainers.image.licenses="AGPL-3.0-or-later"` and `.source`/`.revision`, which feed the footer "Source" link (ADR 0010) |
| Size target | < 150 MB compressed |

### 2.2 Commands (roles)

```
postmodem run            # all-in-one (default)
postmodem web            # HTTP + WebSocket only
postmodem worker         # job queue consumer (mail, thumbnails, federation, digests)
postmodem scheduler      # cron-like enqueuer (prune, backups, stats rollups) — exactly one
postmodem migrate        # apply DB migrations (idempotent, advisory-locked)
postmodem init           # first-run setup non-interactively from env (admin user, board name)
postmodem doctor         # config/permissions/connectivity/self-check (successor of check_files.php)
postmodem backup|restore # consistent dump of DB + /data/uploads to /data/backups or S3
postmodem import <src>   # phpBB2 / Przemo / phpBB3 importer
postmodem ext list|add|remove|enable|disable
postmodem config print   # effective config with secrets redacted, and where each value came from
```

### 2.3 Dockerfile

Implemented in [`/Dockerfile`](../Dockerfile) (M0). Stages: `deps` (Node 24 on
Debian 13 slim + pnpm, lockfile install) → `dev` (sources, Vite dev server) and
`build` → `runtime` (`gcr.io/distroless/nodejs24-debian13:nonroot`, UID 10001).

The `dev` and `runtime` targets share `deps`, so the dev container and the
shipped image are guaranteed to use the same lockfile and Node version.

What M0 established, measured on 2026-11-17:

| Fact | Detail |
|---|---|
| **The runtime needs no `node_modules`** | SvelteKit's adapter-node output plus an esbuild-bundled CLI is fully self-contained (verified by running a copy of `build/` alone). The runtime stage copies one directory |
| **Image size** | 225 MB uncompressed, **54 MB compressed** (budget: 150 MB) |
| **SQLite without native modules** | `node:sqlite` (built into Node 24) behind a small Kysely adapter (ADR 0013), so nothing has to be compiled for arm64 |
| **Works without buildx** | No BuildKit-only syntax (no cache mounts), so plain `docker build` and `docker compose build` work on hosts without the buildx plugin. CI still uses buildx for multi-arch and layer caching |
| **Read-only root** | Verified with `--read-only --tmpfs /tmp`; `/data` is created owned by UID 10001 so named volumes inherit it |
| Not yet in M0 | `/metrics` on port 9090, the `-debug` image variant, `backup`/`restore`/`import`/`ext` commands |

### 2.4 `/data` layout

```
/data
  postmodem.toml          # optional config file (env overrides it)
  db/pm.sqlite     # solo mode only (WAL mode; Litestream-friendly)
  uploads/           # attachments, avatars — when storage driver = local
  extensions/        # installed extension bundles (versioned dirs)
  themes/            # installed themes
  backups/
  secrets/           # auto-generated session/signing keys if not provided
```

## 3. Configuration

Precedence: **defaults → `/data/postmodem.toml` → `POSTMODEM_*` env → `*_FILE` env →
ACP-editable settings in DB** (for board-level settings only; infra settings
are never editable from the browser).

| Variable | Solo default | Stack example |
|---|---|---|
| `POSTMODEM_PUBLIC_URL` | `http://localhost:8080` | `https://forum.example.org` |
| `POSTMODEM_DATABASE_URL` | `sqlite:///data/db/postmodem.sqlite` | `postgres://postmodem@db/postmodem` + `POSTMODEM_DATABASE_PASSWORD_FILE` |
| `POSTMODEM_CACHE_URL` | `memory://` | `redis://valkey:6379` |
| `POSTMODEM_QUEUE` | `db` | `db` (or `redis`) |
| `POSTMODEM_STORAGE_URL` | `file:///data/uploads` | `s3://postmodem-uploads?endpoint=http://garage:3900` |
| `POSTMODEM_SEARCH_URL` | `builtin://` | `meilisearch://search:7700` |
| `POSTMODEM_MAIL_URL` | `log://` | `smtp://mail.example.org:587` |
| `POSTMODEM_REALTIME_URL` | `memory://` | `postgres://` (LISTEN/NOTIFY, default in stack) or `redis://valkey:6379` |
| `POSTMODEM_COUNTERS_URL` | `memory://` (flush every 10 s) | `redis://valkey:6379` |
| `POSTMODEM_AV_URL` | — (scanning off) | `clamd://clamav:3310` |
| `POSTMODEM_PROFILE` | `przemo` | `vanilla` · `przemo` · `modern` (first boot only; see PACKAGES.md §5) |
| `POSTMODEM_SECRET_KEY(_FILE)` | generated into `/data/secrets` | Compose secret |
| `POSTMODEM_TRUSTED_PROXIES` | — | `10.0.0.0/8` |
| `POSTMODEM_ADMIN_EMAIL/PASSWORD_FILE` | used by `postmodem init` on first boot (`POSTMODEM_ADMIN_USERNAME` optional, default `admin`) | |

Config is validated at startup against a schema; invalid config fails fast
with a readable message (container exits non-zero, Compose shows why).

## 4. Compose stack

### 4.1 File layout (shipped in the repo under `deploy/`)

```
deploy/
  compose.yaml            # production stack, profiles for optional services
  compose.solo.yaml       # minimal single-service example
  .env.example
  caddy/Caddyfile
deploy/dev/
  compose.dev.yaml        # dev overrides: build target=dev, watch, mailpit, debug ports
  compose.test.yaml       # CI/e2e: ephemeral volumes, playwright runner
  (legacy board: `--profile legacy` runs ghcr.io/postmodem-bbs/fixture-przemo, see tools/README.md)
```

### 4.2 Solo

```yaml
# compose.solo.yaml
services:
  postmodem:
    image: ghcr.io/postmodem-bbs/postmodem:1
    ports: ["8080:8080"]
    environment:
      POSTMODEM_PUBLIC_URL: http://localhost:8080
    volumes: ["postmodem-data:/data"]
    read_only: true
    tmpfs: ["/tmp"]
    restart: unless-stopped
volumes: { postmodem-data: {} }
```

### 4.3 Full stack (abridged)

```yaml
# compose.yaml
x-postmodem: &Postmodem
  image: ghcr.io/postmodem-bbs/postmodem:${POSTMODEM_VERSION:-1}
  env_file: .env
  environment:
    POSTMODEM_DATABASE_URL: postgres://postmodem@db/postmodem
    POSTMODEM_DATABASE_PASSWORD_FILE: /run/secrets/db_password
    # with --profile scale, set in .env:  POSTMODEM_CACHE_URL=redis://valkey:6379
    # with --profile av,    set in .env:  POSTMODEM_AV_URL=clamd://clamav:3310
  secrets: [db_password, secret_key]
  volumes: ["postmodem-data:/data"]
  read_only: true
  tmpfs: ["/tmp"]
  restart: unless-stopped
  depends_on:
    migrate: { condition: service_completed_successfully }

services:
  migrate:
    <<: *Postmodem
    command: ["migrate"]
    restart: "no"
    depends_on: { db: { condition: service_healthy } }

  web:
    <<: *Postmodem
    command: ["web"]
    deploy: { replicas: 2 }

  worker:
    <<: *Postmodem
    command: ["worker"]

  scheduler:
    <<: *Postmodem
    command: ["scheduler"]

  proxy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes: ["./caddy/Caddyfile:/etc/caddy/Caddyfile:ro", "caddy-data:/data"]

  db:
    image: postgres:18
    environment: { POSTGRES_USER: Postmodem, POSTGRES_PASSWORD_FILE: /run/secrets/db_password }
    secrets: [db_password]
    volumes: ["pg-data:/var/lib/postgresql"]
    healthcheck: { test: ["CMD", "pg_isready", "-U", "Postmodem"], interval: 5s }

  valkey:                          # counters, channels, rate limits across replicas
    image: valkey/valkey:8         # non-authoritative: no persistence required
    profiles: ["scale"]

  clamav:                          # attachment scanning; ~1 GB RAM
    image: clamav/clamav:stable
    profiles: ["av"]

  search:
    image: getmeili/meilisearch:v1
    profiles: ["search"]

  storage:
    image: dxflrs/garage:v2       # S3-compatible
    profiles: ["s3"]

  backup:
    <<: *Postmodem
    command: ["scheduler", "--only=backup"]
    profiles: ["backup"]

secrets:
  db_password: { file: ./secrets/db_password }
  secret_key:  { file: ./secrets/secret_key }
volumes: { postmodem-data: {}, pg-data: {}, caddy-data: {} }
```

Admins compose what they need: `docker compose --profile search --profile s3 up -d`.
Which profile each package benefits from is derived in
[PACKAGES.md §4](PACKAGES.md). In short: `scale` (Valkey) once you run more than
one web replica with realtime/counter-heavy packages, `s3` for multi-host
attachments, `av` for attachment scanning, `search` for large boards.
The app detects absent optional services from config and degrades to the
built-in implementation (in-process cache, DB search, local disk).

### 4.4 Upgrades

`POSTMODEM_VERSION=1.4 docker compose up -d` → `migrate` runs first (advisory lock,
so concurrent starts are safe) → `web/worker` start only after it succeeds.
Rules that make this safe:

- **Expand/contract migrations**: a release never drops/renames what the
  previous release still reads. Destructive steps land one minor version later.
  This makes rolling restarts and one-version rollback possible.
- `postmodem migrate --dry-run` and an automatic pre-migration backup (configurable).
- Solo mode runs the same migration step in-process at boot.

## 5. Development workflow

### 5.1 One command to start

```bash
docker compose -f deploy/compose.yaml -f deploy/dev/compose.dev.yaml up --watch
```

(wrapped as `make dev` / `pnpm dev:stack`). This gives:

- `web` built from the **`dev` target**, source synced via Compose `develop.watch`
  (`sync` for source → Vite HMR; `rebuild` when the lockfile changes).
- Postgres with a **seeded demo board** (categories, users, long threads,
  Polish + English content, edge cases like 10k-post topics).
- **Mailpit** at `:8025` — every e-mail the board sends is visible.
- Meilisearch + Garage under profiles, so devs can exercise the "stack" paths.
- Node inspector port exposed for debugger attach.
- `POSTMODEM_DATABASE_URL` switch to run the same dev stack on SQLite
  (`--profile sqlite`), because solo mode must stay first-class.

### 5.2 Dev Container

`.devcontainer/devcontainer.json` points at the same Compose files, so VS Code,
JetBrains Gateway, Codespaces and Claude Code all get an identical toolchain
(Node, pnpm, Playwright browsers, `docker` CLI via the host socket or
docker-in-docker). The only host requirement for contributing is Docker.

### 5.3 Inner loop vs outer loop

| Loop | Where | Speed target |
|---|---|---|
| Unit tests, typecheck, lint | inside dev container, watch mode | < 2 s feedback |
| Integration (DB, queue, storage) | Testcontainers spinning Postgres/SQLite per suite | < 1 min |
| Importer tests | `deploy/dev/legacy` MariaDB with a real Przemo 1.12 schema + anonymised dump | on demand + CI |
| E2E + a11y | Playwright container against the **runtime image**, not the dev server | CI, or `make e2e` locally |

### 5.4 Extension & theme development

Both tiers ([ADR 0003](adr/0003-two-tier-extensions.md)) fit the rule that the
runtime image never compiles anything:

- **Tier-1 add-ons** need no toolchain at all: HTML templates, plain JS and CSS
  are the shipped artefact. They can be written in the ACP editor on a live
  board (stored in `/data/extensions`), or locally and hot-reloaded with
  `postmodem ext dev ./my-addon`, which needs no Node toolchain on the host because
  it runs inside the container.
- **Tier-2 modules** are built in the dev container (or the author's CI);
  `postmodem ext dev ./my-module` mounts and hot-reloads them into the running board.
- `postmodem ext pack` produces a signed bundle (`.pmext`: manifest, templates,
  assets, locales; plus compiled JS and migrations for modules). This is what
  the runtime image installs.
- `postmodem ext export <id>` turns an add-on edited in the ACP into a bundle, so
  the "tweak it live, then share it" workflow from the Przemo forums still works.
- Admins install bundles either from the ACP (downloaded into
  `/data/extensions`) **or** declaratively, which suits Compose users:

  ```dockerfile
  FROM ghcr.io/postmodem-bbs/postmodem:1
  COPY --chown=10001 extensions/*.pmext /opt/postmodem/preinstalled/
  ```
  or `POSTMODEM_EXTENSIONS=shoutbox@^1,ranks@^2` resolved at boot from the directory
  (opt-in, cached in `/data`). Declarative wins over ACP state when both exist,
  so infra-as-code users get reproducibility.

## 6. CI/CD pipeline

```
 PR / push
   │
   ├─ lint · typecheck · unit                    (dev target, cached)
   │
   ├─ build runtime image ── amd64+arm64 ──► push ghcr.io/postmodem-bbs/postmodem:sha-<sha>
   │        │
   │        ├─ image scan (Trivy/Grype), SBOM, size budget check
   │        ├─ integration matrix  {sqlite, postgres 16/17/18} × counters/channels {memory, postgres, valkey}
   │        ├─ package matrix      {core only, przemo profile} (+ random subsets nightly)
   │        ├─ e2e + axe a11y      {solo compose, full stack compose} × {Classic, Modern theme}
   │        ├─ upgrade test        previous release → this image (migrations, rollback one version)
   │        └─ importer test       Przemo dump → this image
   │
 tag vX.Y.Z
   └─ re-tag tested digest → :X.Y.Z :X.Y :X :latest · cosign sign · attest provenance
      publish compose bundle (deploy/*) as release asset · changelog
```

- Nightly: `:edge` from main, Renovate updates for base images and services
  pinned in `deploy/compose.yaml`, full matrix run.
- Registry: GHCR primary, Docker Hub mirror (discoverability for hobbyists).

## 7. Operations baked in

- **Backups**: `postmodem backup` is consistent across DB and uploads; scheduler can
  run it nightly with retention; SQLite users can add Litestream as a sidecar.
- **Observability**: `/metrics`, structured logs with request IDs, optional OTel;
  example Grafana dashboard shipped in `deploy/observability/` (profile).
- **Doctor**: `docker compose exec web postmodem doctor` checks config, volumes'
  ownership/permissions, DB/migration state, external services, clock skew,
  public URL reachability.
- **Resource defaults**: documented memory/CPU limits for solo (≈256 MB) and
  per-role in the stack. These follow the soft budget in DESIGN.md §5.1, which
  CI checks as alarms rather than hard gates.
- **Kubernetes** later: the same image and roles map directly onto a Helm
  chart; nothing in this design assumes Compose-only features.

## 8. Repository skeleton (M0)

```
postmodem/
  apps/server/            # SvelteKit app + CLI entry (bin/Postmodem)
  packages/core/          # domain, permissions, settings
  packages/db/            # Kysely schema, migrations, repositories (sqlite + pg)
  packages/sdk/           # public extension SDK (versioned separately)
  packages/ui/            # base components, theme tokens
  extensions/*            # first-party modules, built as .pmext too
  themes/{classic,modern}
  deploy/                 # compose files, Caddyfile, .env.example
  deploy/dev/
  .devcontainer/
  Dockerfile
  Makefile                # dev, test, e2e, image, release-dry-run
  .github/workflows/
```

## 9. Open decisions

1. **Base image**: distroless (smallest, no shell) vs Wolfi/Chainguard vs Alpine
   (easier debugging, musl quirks). Recommended: distroless + `-debug` variant.
2. **Solo-mode extras**: bundle Caddy inside the solo image for automatic HTTPS
   (one container really is everything) vs keep TLS out of the app image.
   Recommended: separate `postmodem:X-caddy` flavour, keep the main image pure.
3. **Runtime extension install from ACP** in container deployments. Recommended:
   tier-1 add-ons allowed by default (they can't run server code); tier-2
   modules declarative-only (`POSTMODEM_EXTENSIONS` / derived image), with ACP
   install as an opt-in.
4. **Registry/CI host**: GitHub (GHCR + Actions) vs self-hosted Forgejo.
