# syntax=docker/dockerfile:1
# =============================================================================
# payswap3 — web-api-boundary runtime image (DEP-002)
#
# Multi-stage, deterministic build. The runtime package is the Next.js
# standalone server produced by `next build` with `output: "standalone"`
# (next.config.ts); this image wraps it in a pinned Node base and runs it as
# a non-root user.
#
# Stages:
#   1. deps    — install the dependency graph from package.json + lockfile
#                only (npm ci: exact, lockfile-driven, cache-friendly).
#   2. build   — run the repository production build (npm run build) which
#                emits .next/standalone (+ static assets and public files).
#   3. runtime — copy ONLY the standalone output; no source, no dev tooling,
#                no build secrets; runs as non-root.
#
# Configuration contract (spec/deployment/packaging.md):
#   - PAYSWAP_ENV is accepted ONLY as a runtime ARG/ENV and defaults to
#     "sandbox" (the fail-safe). It is NEVER set to "production" at build
#     time: the production value is injected at runtime by deployment
#     configuration only (F2). No build stage reads or sets it.
#   - No secret values exist in this file or in any stage (S1–S5). Production
#     secret NAMES (PAYSWAP_DATABASE_URL, PAYSWAP_QUEUE_URL,
#     PAYSWAP_EVIDENCE_STORE_URL, PAYSWAP_RAIL_ADAPTERS_URL) are declared in
#     src/lib/startup-config.ts and injected as environment variables by the
#     deployment platform at runtime.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: deps — deterministic dependency installation
# Only the manifests are copied first so this layer depends solely on the
# lockfile. `npm ci` installs exactly the locked dependency graph (fails if
# package.json and package-lock.json are out of sync — a determinism guard).
# -----------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# -----------------------------------------------------------------------------
# Stage 2: build — production build of the standalone runtime package
# Runs the repository's own build script ("next build", standalone output).
# PAYSWAP_ENV is deliberately NOT set in this stage: no environment value is
# baked into any build artifact (F2). Telemetry is disabled for
# reproducibility (no external calls influencing the build).
# -----------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3: runtime — standalone server, non-root, runtime-only configuration
# Contains ONLY: the standalone server, its static assets, public files, and
# the traced minimal node_modules. No source, no devDependencies, no lockfile,
# no docs, no secrets.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# PAYSWAP_ENV — the ONLY place a default exists in the image. Runtime-only:
# deployments override/inject it through their own environment configuration
# (docker run -e, compose, platform secret injection). Default is the
# fail-safe "sandbox" (F2/F4). The value "production" is never baked here.
ARG PAYSWAP_ENV=sandbox
ENV PAYSWAP_ENV=$PAYSWAP_ENV

# Non-root runtime user (least privilege).
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
USER nextjs

# The runtime package: standalone server + traced dependencies...
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# ...plus the static assets and public files it serves.
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# The application port (matches PORT above).
EXPOSE 3000

# Health contract (spec/deployment/packaging.md):
#   liveness  — GET /api/health → 200 {status, component, env}
#   readiness — GET /api/ready  → 200 when startup configuration validates;
#               503 with NAMED failing check ids otherwise (fail-closed, F6).
CMD ["node", "server.js"]
