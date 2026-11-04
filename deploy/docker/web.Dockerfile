# syntax=docker/dockerfile:1.7
FROM node:22.20.0-bookworm-slim AS base
ENV CI=true NEXT_TELEMETRY_DISABLED=1
# npm-installed pnpm (corepack in older Node images ships expired registry signing keys)
RUN npm install -g pnpm@10.28.0 && pnpm --version
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
# Every workspace manifest must be present for a frozen-lockfile install.
COPY apps/api/package.json ./apps/api/package.json
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter "./packages/{config,contracts}" build && pnpm --filter @wd/web build

# Hardened runtime: all Debian security updates applied at build time, package managers removed
# (npm/corepack/yarn carried vulnerable bundled modules), non-root user. Rebuild weekly to pick up fixes.
FROM node:22.20.0-bookworm-slim AS runtime
RUN apt-get update && apt-get -y upgrade && apt-get clean && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["apps/web/server.js"]
