# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Base: debian:bullseye with Node 20.
#
# Bullseye's own apt repository carries Node 12, which is far too old for Vite
# and for the `node:` prefixed imports used in the server, so Node is installed
# from the official distribution tarball. The tarball is taken over the
# NodeSource convenience script deliberately: it is a pinned version with a
# published checksum that is verified below, rather than piping a remote script
# into a shell.
# ---------------------------------------------------------------------------
FROM debian:bullseye AS base

ARG NODE_VERSION=20.17.0
ENV DEBIAN_FRONTEND=noninteractive

RUN rm -f /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources \
 && printf '%s\n' \
      'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260831T235959Z/ bullseye main' \
      'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260831T235959Z/ bullseye-updates main' \
      'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20260831T235959Z/ bullseye-security main' \
      > /etc/apt/sources.list \
 && apt-get -o Acquire::Retries=3 update \
 && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
      ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      amd64) NODE_ARCH='x64' ;; \
      arm64) NODE_ARCH='arm64' ;; \
      armhf) NODE_ARCH='armv7l' ;; \
      *) echo "Unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac; \
    TARBALL="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep " ${TARBALL}\$" SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "${TARBALL}" -C /usr/local --strip-components=1 --no-same-owner; \
    rm "${TARBALL}" SHASUMS256.txt; \
    node --version; \
    npm --version

WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies. Copying only the manifests first means this layer is reused
# whenever source changes but dependencies do not.
# ---------------------------------------------------------------------------
FROM base AS deps

COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/

# `npm ci` needs a lockfile; fall back to `install` so a fresh clone still
# builds before the lockfile has been committed.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---------------------------------------------------------------------------
# Build: typecheck, test, then bundle the client and the server.
#
# Tests run inside the image build on purpose. The deliverable is the image, so
# an image that builds is an image whose tests passed.
# ---------------------------------------------------------------------------
FROM deps AS build

COPY tsconfig.base.json ./
COPY shared/ shared/
COPY server/ server/
COPY client/ client/

RUN npm run typecheck
RUN npm test
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime: production dependencies plus the two build outputs. No toolchain,
# no sources, no dev dependencies.
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    MAP_FILE=/data/map.json \
    CLIENT_DIR=/app/client/dist

COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/

RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
 && npm cache clean --force

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

# The map is the operator's work, so it lives on a volume rather than in the
# writable layer. An unnamed `docker run` still works: the store seeds the
# sample map on first read.
RUN groupadd --gid 1000 node \
 && useradd --uid 1000 --gid node --create-home node \
 && mkdir -p /data \
 && chown -R node:node /data /app
VOLUME ["/data"]

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
