# syntax=docker/dockerfile:1.7
# API + worker image (same image, different command). Non-root, no build tools in the runtime layer.
FROM node:22.20.0-bookworm-slim AS base
ENV CI=true
# npm-installed pnpm (corepack in older Node images ships expired registry signing keys)
RUN npm install -g pnpm@10.28.0 && pnpm --version
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
# Every workspace manifest must be present for a frozen-lockfile install.
COPY apps/web/package.json ./apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter "./packages/{config,contracts,rbac,sla-time}" build && pnpm --filter @wd/api build
RUN pnpm --filter @wd/api deploy --legacy --prod /out && cp -r apps/api/dist /out/dist

# Distroless runtime: Node.js + libc only. No shell, no package manager, no OS tools to patch or abuse.
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /out /app
EXPOSE 4000 9464
HEALTHCHECK --interval=15s --timeout=3s CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Entrypoint is node; override the script for the worker (dist/src/worker.js) or setup (dist/db/setup.js).
CMD ["dist/src/main.js"]
