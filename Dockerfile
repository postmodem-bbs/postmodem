# syntax=docker/dockerfile:1.10
# SPDX-License-Identifier: AGPL-3.0-or-later
# One image, many roles (CONTAINERS.md §2). Targets:
#   dev      — toolchain + sources, runs the Vite dev server (compose.dev.yaml, Dev Container)
#   runtime  — distroless, non-root, read-only friendly; only the self-contained build output

ARG NODE_VERSION=24

# ── dependencies (shared by dev and build, so both use the same lockfile and Node) ──
FROM node:${NODE_VERSION}-trixie-slim AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install --global --no-fund --no-audit --allow-scripts=pnpm pnpm@12.19.0
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/i18n/package.json packages/i18n/
COPY packages/ui/package.json packages/ui/
# No BuildKit cache mount on purpose: the legacy builder must work too (Docker without buildx).
# Layer caching still skips this step unless a manifest or the lockfile changes.
RUN pnpm install --frozen-lockfile

# ── dev: used by deploy/dev/compose.dev.yaml ──
FROM deps AS dev
COPY . .
ENV NODE_ENV=development POSTMODEM_DATA_DIR=/data
EXPOSE 5173
CMD ["pnpm", "--filter", "@postmodem/server", "dev"]

# ── build ──
FROM deps AS build
COPY . .
RUN pnpm --filter @postmodem/server build \
 && mkdir -p /out/data && cp -r apps/server/build /out/app && cp -r LICENSE LICENSE-EXCEPTION.md LICENSES /out/app/

# ── runtime ──
FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime
ARG POSTMODEM_VERSION=0.0.0-dev
ARG POSTMODEM_REVISION=unknown
LABEL org.opencontainers.image.title="Postmodem" \
      org.opencontainers.image.description="A modern bulletin board in the Przemo tradition" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/postmodem-bbs/postmodem" \
      org.opencontainers.image.url="https://postmodem.app" \
      org.opencontainers.image.version="${POSTMODEM_VERSION}" \
      org.opencontainers.image.revision="${POSTMODEM_REVISION}"
ENV NODE_ENV=production \
    POSTMODEM_DATA_DIR=/data \
    POSTMODEM_VERSION=${POSTMODEM_VERSION} \
    POSTMODEM_REVISION=${POSTMODEM_REVISION}
COPY --from=build /out/app /app
# /data is created owned by the runtime user so named volumes inherit the ownership.
COPY --from=build --chown=10001:10001 /out/data /data
USER 10001:10001
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["/nodejs/bin/node", "/app/postmodem.js", "healthcheck"]
ENTRYPOINT ["/nodejs/bin/node", "/app/postmodem.js"]
CMD ["run"]
