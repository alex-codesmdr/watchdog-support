# Architecture Decision Records — WatchDog Support Portal

Format: Context · Decision · Consequences · Alternatives. ADR-001…016: **Accepted** (approved 2026-11-04). ADR-017…021 added in Phase 2.

---

## ADR-001 Modular monolith on NestJS

**Context.** ~15 domains, a 3–5 person maintenance team, on-prem deployments where operating many services is costly.
**Decision.** One NestJS codebase with strict module boundaries, deployed as two process types from the same image: `api` (HTTP) and `worker` (BullMQ consumers). Boundaries enforced by `eslint-plugin-boundaries` and dependency-cruiser; cross-module side effects via domain events + outbox.
**Consequences.** Simple deployments, single transaction scope, easy refactors; services can be extracted later along module seams (likely candidates: search-indexer, email-ingest, file-scan).
**Alternatives.** Microservices from day one (rejected: ops burden, distributed transactions); a single Next.js full-stack app (rejected: weak for heavy background processing and public API).

## ADR-002 Monorepo with pnpm + Turborepo

**Decision.** `apps/web`, `apps/api` (with worker entrypoint), `packages/contracts|ui|config|i18n|brand-lint|sla-time|test-utils`, `deploy/{compose,helm,terraform}`.
**Consequences.** Shared Zod contracts give end-to-end types; Turborepo caching keeps CI fast. Requires discipline on package boundaries.

## ADR-003 PostgreSQL 16 with Kysely and SQL migrations

**Context.** We need RLS policies, exclusion constraints, partitioning, generated tsvector columns and SQL functions.
**Decision.** Kysely (type-safe query builder) with versioned up/down SQL migrations; types generated from the schema (`kysely-codegen`). No ORM magic in the data path.
**Consequences.** Full SQL control and RLS-friendly; slightly more boilerplate than Prisma. Down-migrations are mandatory and CI tests up→down→up.
**Alternatives.** Prisma (weak RLS / per-transaction `SET LOCAL` story, limited DDL), TypeORM (maintenance concerns).

## ADR-004 Tenant isolation: shared schema + RLS, fail-closed

**Decision.** All tenant tables carry `org_id`; RLS `ENABLE`d (see ADR-017 on FORCE); app role is non-owner; GUCs set with `SET LOCAL` inside every transaction; PgBouncer in transaction mode. App-layer CASL checks on top. Optional dedicated database per mission-critical tenant through a tenant router.
**Consequences.** One schema to migrate; strong guarantee even against app bugs. Every query must run inside the request transaction wrapper (enforced by not exporting the raw pool).
**Alternatives.** Schema-per-tenant (2,000+ schemas, migration pain), DB-per-tenant for all (cost).

## ADR-005 Keycloak for identity; BFF session pattern in Next.js

**Decision.** Keycloak handles OIDC/SAML, MFA (TOTP, optional WebAuthn), brute-force protection, identity brokering (Entra ID for staff, per-org IdPs) and SCIM via extension. Next.js route handlers act as a BFF: Authorization Code + PKCE, tokens stored server-side (Redis), browser only gets an HttpOnly `__Host-` session cookie. API validates JWTs (JWKS cache) and re-derives roles from DB.
**Consequences.** No tokens reachable by XSS; works on-prem; the portal owns authorization while Keycloak owns authentication. Keycloak needs HA and realm-as-code (`keycloak-config-cli`).
**Alternatives.** Auth.js-only (no SAML brokering/MFA maturity), commercial IdPs (not deployable on-prem).

## ADR-006 Background jobs: BullMQ + transactional outbox

**Decision.** Domain writes insert `outbox_event` in the same transaction; a relay publishes to BullMQ queues; consumers are idempotent (event id dedupe). Queues: `sla`, `email-in`, `email-out`, `file-scan`, `search-index`, `webhooks`, `reports`, `reminders`.
**Consequences.** No lost or phantom events; Redis loss is recoverable by replaying unpublished outbox rows.

## ADR-007 OpenSearch for search (over Meilisearch)

**Context.** Need typo tolerance, facets, per-document ACL filters, clustering on-prem, and later vector search for RAG.
**Decision.** OpenSearch 2.x with index-per-domain (`kb`, `cases`, `downloads`, `advisories`, `catalog`) and mandatory filter injection for `org_id`/`visibility`. Postgres FTS as degraded-mode fallback.
**Consequences.** Heavier to operate than Meilisearch but Apache-2.0, HA-capable, and has a k-NN plugin reusable in Phase 5.
**Alternatives.** Meilisearch (excellent DX and typo tolerance; weaker HA/clustering for on-prem at the time of writing and no unified vector+ACL story we need).

## ADR-008 Object storage and file pipeline

**Decision.** S3-compatible API (AWS S3 / MinIO). Buckets: `quarantine`, `attachments`, `firmware` (object-locked), `exports`, `audit-anchors`. Uploads via tus (resumable, chunked) to quarantine → `file-scan` worker (magic bytes, ClamAV, archive limits, secret masking for text/log/config) → promote. Downloads only via 5-minute signed URLs on a separate download hostname.
**Consequences.** Large tech-support bundles (≤ 2 GB configurable) upload reliably on poor links; nothing is served before scanning.

## ADR-009 SLA engine computed deadlines with dual triggering

**Decision.** Store `due_at` per clock (recomputed on pause/resume/severity change) using a pure business-time library; trigger warnings by precise delayed jobs plus a 30 s safety-net tick; idempotent via `last_warn_pct`. Policies are versioned and snapshotted onto cases.
**Consequences.** Cheap queue queries (`WHERE due_at < now()`), correct after restarts, explainable in audits.

## ADR-010 API contracts: Zod-first, OpenAPI 3.1 generated

**Decision.** Request/response schemas live in `@wd/contracts` (Zod); NestJS uses them for validation (`nestjs-zod`), OpenAPI is generated with examples, and the frontend consumes the same types. Response serializers are explicit allowlists.
**Consequences.** Single source of truth; impossible to accidentally return a column (e.g., `internal_oem_ref`) not in the schema.

## ADR-011 Authorization: permissions + CASL, matrix-driven tests

**Decision.** Atomic permission keys bundled into DB roles; CASL abilities with conditions; `rbac.matrix.yaml` generates the authorization test suite (every endpoint × role × own/foreign org). Foreign-tenant access returns 404.
**Consequences.** Authorization changes are reviewed as data diffs and automatically regression-tested.

## ADR-012 Brand protection ("brand-lint")

**Decision.** `@wd/brand-lint` holds a prohibited-terms list loaded from a CI secret/variable (so the list itself is not committed in plaintext), plus case/leet/spacing-insensitive matching. Runs on: source, seed data, migrations, built `.next` HTML/JS, generated OpenAPI, sample PDFs and emails, artifact file names, and Playwright-crawled rendered pages. `internal_oem_ref` fields are excluded from contracts for non-internal roles and from search/exports/logs (pino redact paths).
**Consequences.** Acceptance criterion "zero occurrences" is mechanically provable on every PR.

## ADR-013 Frontend: Next.js App Router, Tailwind, shadcn/ui, TanStack Query, RHF + Zod

**Decision.** As proposed. Public content pages statically generated with ISR; authenticated pages server-rendered with streaming; client data via TanStack Query; design tokens as CSS variables (brand-configurable, dark/light); Storybook as design-system docs with axe add-on.
**Consequences.** Good Lighthouse and p95 performance on 4G; one design system across portal, workspace and admin.

## ADR-014 Outbound integrations: adapters, egress control

**Decision.** Every integration is an interface (`CrmAdapter`, `BugTrackerAdapter`, `ChatOpsAdapter`, `SmsAdapter`, `MailTransport`, `MailInbox`, `LlmProvider`) with a mock and real implementations selected by config. All outbound HTTP goes through one `SafeHttpClient` (https-only, DNS-pinned private-IP blocking, no redirects, timeouts, egress proxy).
**Consequences.** Testable, SSRF-resistant, swappable per deployment.

## ADR-015 Email: MJML templates, reply-token threading

**Decision.** Templates in MJML + ICU messages per locale (en, hi). Outbound `Reply-To: case+{caseNumber}.{hmac8}@support.watchdog.example`; inbound threading by reply token, then `In-Reply-To`/`References`, then subject case number; quoted text stripping; unknown senders held for review.
**Consequences.** Robust threading and spoof resistance; templates editable in admin with preview.

## ADR-016 Observability and audit

**Decision.** OpenTelemetry SDK for traces/metrics; Prometheus scrape on internal port; pino JSON logs with redaction; audit log as append-only, monthly-partitioned, hash-chained table with daily anchor to WORM bucket; 180-day minimum retention (CERT-In) configurable upward.
**Consequences.** Tamper-evident audit trail; vendor-neutral telemetry that works on-prem.

---

## ADR-017 RLS enabled (not forced); boot-time role assertion

**Context.** `FORCE ROW LEVEL SECURITY` also applies RLS to the table owner, which breaks the few narrow `SECURITY DEFINER` functions that must read across tenants (principal resolution before tenant context exists, self-registration, public warranty lookup, audit-chain hashing, display names).
**Decision.** RLS is `ENABLE`d on every tenant table. The application role `wd_app` is not the owner and has `NOBYPASSRLS`, so RLS always applies to it. API and worker refuse to start if their role owns tables, is superuser or bypasses RLS (`Database.assertSafeRole`). Cross-tenant logic lives only in reviewed definer functions with fixed `search_path`.
**Consequences.** Same guarantee for the app path; the owner credential becomes the crown jewel and is used only by migrations (separate secret, never mounted into api/worker pods).

## ADR-018 Column-level privilege for internal OEM mapping

**Decision.** `wd_app` is granted `SELECT` on every `product` column except `internal_oem_ref`. Staff read it only via `wd.product_internal_ref()` (checks internal context); the API additionally requires `product:read:internal_ref`.
**Consequences.** Even `SELECT *` or a serializer bug cannot leak the mapping; it fails with "permission denied". Brand-lint remains the outer check.

## ADR-019 Self-hosted fonts

**Decision.** IBM Plex is bundled from `@fontsource` (npm) instead of Google Fonts.
**Consequences.** Works air-gapped (government/BFSI on-prem), CSP `font-src 'self'`, no third-party requests from the portal.

## ADR-020 Mock OIDC provider for fast E2E; Keycloak E2E in CI

**Decision.** `apps/web/e2e/mock-oidc.mjs` implements discovery, Authorization Code + PKCE, refresh and logout with `acr=mfa`, so Playwright runs without a container runtime. A separate CI job runs the same suite against Keycloak from `docker compose`.
**Consequences.** Quick feedback on every PR; the Keycloak job guards realm configuration drift. The mock is dev/test only and is not packaged in any image.

## ADR-021 Hand-maintained Kysely types in Phase 2

**Decision.** `src/db/schema.ts` is written by hand alongside migrations; `kysely-codegen` replaces it once the CI database job publishes generated types.
**Consequences.** Small drift risk, mitigated by the integration suite exercising every table through the API.

## ADR-022 S3-compatible storage without MinIO community images

**Context.** MinIO stopped publishing community container images (pulls of `minio/mc` fail), which broke the local stack.
**Decision.** Local and reference on-prem stack use SeaweedFS (Apache-2.0) through the standard S3 API. The code depends only on the S3 API, so production may use AWS S3, Ceph RGW, SeaweedFS or a licensed MinIO. Buckets can be created at start-up (`S3_ENSURE_BUCKETS`), and download URLs are signed against a browser-facing endpoint (`S3_PUBLIC_ENDPOINT`).
**Consequences.** ADR-008's MinIO references now read "any S3-compatible store". Object lock for firmware (Phase 3) must be confirmed for the chosen production store.

## ADR-023 Knowledge-base search on PostgreSQL first (amends ADR-007)

**Context.** ADR-007 chose OpenSearch. Acceptance criterion 5 needs typo tolerance, facets and < 500 ms on 10,000 articles. The post-handover team is 3–5 developers and many installs are on-prem.
**Decision.** Phase 3 implements search in PostgreSQL: weighted `tsvector` (title > summary/firmware > body; English stemming plus a verbatim copy of titles for model numbers and error codes), `pg_trgm` word similarity for typos, `GROUPING SETS` facets, audience filtering in the same query. The search lives behind `KbService.search`, so an OpenSearch adapter can replace it without API changes.
**Evidence.** Integration test with 10,014 published articles: p50 87–142 ms, p95 221–259 ms end-to-end through the API (60 queries, three audiences).
**Consequences.** One less cluster to run, back up and secure; search is transactionally consistent with publishing. Revisit when Phase 5 RAG needs vector search, or above ~250,000 articles, or for multilingual (Hindi) stemming.

## ADR-024 Download entitlement is computed per request, enforced twice

**Context.** Firmware must reach only customers with active coverage on a compatible model; MIBs and release notes should be public; engineer tools must never leave WatchDog.
**Decision.** Releases carry one of four visibility levels (public, registered, entitled, internal). Entitlement is evaluated on every list and link request by `wd.entitled_to_release()`, which runs as the caller so tenant RLS limits the devices it can see. RLS on `software_release` additionally hides drafts and internal releases from non-staff sessions. Files are stored only after antivirus, links live 5 minutes, and every link issued writes `download_event` plus an audit entry. Licence acceptance is recorded per user and licence version.
**Consequences.** A lapsed contract stops downloads immediately (no cached grants). Object lock / immutability for firmware still depends on the production S3 store (see ADR-022).

## ADR-025 Idempotency-Key for case creation stored in PostgreSQL

**Decision.** `POST /api/v1/cases` accepts `Idempotency-Key`. The key is claimed (`INSERT … ON CONFLICT DO NOTHING`) per user before the case is created, together with a hash of the request body; a replay returns the first case, a different body with the same key is refused, and a concurrent duplicate gets 409. A failed attempt releases the key.
**Consequences.** No Redis dependency for correctness; keys can be pruned after 24 hours by a housekeeping job (Phase 5 hardening).
