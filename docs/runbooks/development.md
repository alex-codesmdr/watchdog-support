# Runbook: development

## Daily loop
1. `docker compose up -d postgres redis keycloak mailpit minio minio-buckets clamav` (or bare-metal services, see README).
2. `pnpm --filter "./packages/*" build` after changing a shared package (`contracts`, `rbac`, `sla-time`, `config`).
3. `pnpm --filter @wd/api dev`, `pnpm --filter @wd/api dev:worker`, `pnpm --filter @wd/web dev`.

## Adding a migration
1. Create `apps/api/db/migrations/NNNN_short_name/{up.sql,down.sql}`. Both are required; CI runs up → down → up.
2. Every new tenant table: `org_id uuid NOT NULL`, `ENABLE ROW LEVEL SECURITY`, a read policy using `wd.can_see_org(org_id)`,
   explicit `GRANT`s to `wd_app` (no blanket grants), and add the table to the isolation list in `test/tenant-isolation.int.test.ts`.
3. Update `src/db/schema.ts` (hand-maintained until codegen, ADR-021).
4. Never change a migration that has run in a shared environment. Add a new one instead.

## Adding an endpoint
1. Request/response schema in `packages/contracts` (responses are allowlists).
2. Controller method: validate with `parse(Schema, body)`; declare `@RequirePermission(...)`; use `db.withTenant(principal, …)`.
3. Register the path in `src/openapi/document.ts` with an example.
4. Add the endpoint to `endpoints:` in `packages/rbac/rbac.matrix.yaml` (set `tenant: true` for tenant resources). The authorization tests are generated from it.

## Changing a role
Edit `rbac.matrix.yaml`, run `pnpm db:seed` (it syncs roles/permissions), run the integration suite. The diff in the YAML is the review artefact.

## Brand lint locally
Put the prohibited terms, one per line, in `.brand-terms` (gitignored), then `pnpm brand-lint`. Findings print masked terms only.
