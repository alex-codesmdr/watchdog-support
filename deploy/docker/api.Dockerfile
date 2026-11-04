# syntax=docker/dockerfile:1.7
# API + worker image (same image, different command). Non-root, no build tools in the runtime layer.
FROM node:22.12-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @wd/api...
RUN pnpm --filter "./packages/{config,contracts,rbac,sla-time}" build && pnpm --filter @wd/api build
RUN pnpm --filter @wd/api deploy --legacy --prod /out && cp -r apps/api/dist /out/dist

FROM node:22.12-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 4000 9464
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/main.js"]
