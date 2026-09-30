FROM node:24.21.0-alpine

# Build metadata (issue #1047). The publishing workflow passes these at
# `docker build` time; a local build falls back to the "unknown" placeholders
# that `GET /version` reports.
ARG BUILD_VERSION=unknown
ARG BUILD_REVISION=unknown
ARG BUILD_SOURCE=https://github.com/BCPathway/bc-forge
ARG BUILD_DATE=unknown
ARG BUILD_NAME=bc-forge-indexer

# OCI image annotations. Declared before the dependency layers so changing
# build metadata does not invalidate the cached npm/prisma layers.
LABEL org.opencontainers.image.title="bc-forge-indexer" \
      org.opencontainers.image.description="Server indexer microservice for bc-forge" \
      org.opencontainers.image.source="${BUILD_SOURCE}" \
      org.opencontainers.image.revision="${BUILD_REVISION}" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="BCPathway" \
      org.opencontainers.image.source-name="${BUILD_SOURCE}"

# openssl is required by the Prisma query engine on Alpine. libc6-compat is
# the glibc loader shim some Prisma native binaries probe for; it is harmless
# on musl and lets the engines start on both amd64 and arm64 (#1049).
# node:24.21.0-alpine is a multi-arch base, so Buildx can produce linux/amd64
# and linux/arm64 from this Dockerfile under one manifest list.
RUN apk add --no-cache openssl libc6-compat

# Build from the repository root. @bc-forge/indexer depends on the
# @bc-forge/sdk workspace, which is not published, so an indexer-only
# context cannot npm ci.
WORKDIR /app

COPY package.json package-lock.json ./
COPY sdk/package.json ./sdk/package.json
COPY cli/package.json ./cli/package.json
COPY react/package.json ./react/package.json
COPY indexer/package.json ./indexer/package.json

# Install only the indexer workspace. Including the workspace root also
# installs VitePress, whose esbuild binary is compiled with a vulnerable
# Go stdlib. The base image's npm bundles tar 7.5.19 (CVE-2026-59873).
RUN npm ci --workspace @bc-forge/indexer --include-workspace-root=false

COPY sdk ./sdk
COPY indexer/prisma ./indexer/prisma
COPY indexer/tsconfig.json ./indexer/tsconfig.json
COPY indexer/src ./indexer/src
COPY indexer/scripts ./indexer/scripts

WORKDIR /app/indexer

# Generate Prisma client. binaryTargets vendors engines for linux/amd64 and
# linux/arm64, and this RUN executes per-platform under Buildx/QEMU (#1049).
RUN npx prisma generate
RUN npm run build

EXPOSE 3000
ENV PORT=3000

# Build metadata surfaced at runtime by the unauthenticated GET /version
# endpoint, so an operator can identify the commit a container is running.
ENV BUILD_NAME=${BUILD_NAME} \
    BUILD_VERSION=${BUILD_VERSION} \
    BUILD_REVISION=${BUILD_REVISION} \
    BUILD_SOURCE=${BUILD_SOURCE} \
    BUILD_DATE=${BUILD_DATE}

CMD ["npm", "start"]
