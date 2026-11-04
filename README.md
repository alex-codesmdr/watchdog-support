# WatchDog Support Portal

Helpdesk and technical-support portal for WatchDog networking, security, wireless and server products:
TAC-style case management with SLAs, assets and entitlements, and (in later phases) knowledge base, downloads,
RMA, advisories and reporting.

**Status: Phase 2 (foundation + case-management MVP).** See [`docs/PHASE2.md`](docs/PHASE2.md) for what is
delivered, acceptance-criteria status and open risks. Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
decisions: [`docs/ADR.md`](docs/ADR.md).

## Quick start (one command)

```bash
cp .env.example .env          # local-only values; never commit real secrets
docker compose up --build     # first run takes a few minutes (ClamAV downloads signatures)
```

| URL | What |
|---|---|
| http://localhost:3000 | Portal |
| http://localhost:4000/api/docs | API reference (OpenAPI 3.1) |
| http://localhost:8025 | Mailpit: every email the portal sends |
| http://localhost:8080 | Keycloak admin (`admin` / `admin`) |
| http://localhost:9001 | MinIO console |

Demo sign-in (local only): any user below, password `Demo@WatchDog2026`. Each has a pre-enrolled authenticator:
add base32 secret `K5QXIY3IIRXWORDFNVXVI33UOBFWK6JSGAZDM===` to any TOTP app.

| User | Role | Organisation |
|---|---|---|
| `noc@kaveribank.example` | Customer user | Kaveri Cooperative Bank (Demo) |
| `it.admin@kaveribank.example` | Customer admin | Kaveri Cooperative Bank (Demo) |
| `netops@narmadacity.example` / `admin@narmadacity.example` | Customer user / admin | Narmada Smart City Authority (Demo) |
| `support@sahyadri-si.example` | Partner (delegated by Narmada) | Sahyadri Systems Integrators (Demo) |
| `asha.l1@…`, `vikram.l2@…`, `farah.l3@watchdog.example` | L1 / L2 / L3 engineer | WatchDog |
| `rohan.manager@watchdog.example` | Support manager | WatchDog |
| `neha.admin@watchdog.example` | System administrator | WatchDog |

Demo devices: `WDSW5600A0001` (Mission-Critical 24×7), `WDFW3100B0002` (Premium), `WDSDW1200C0003`
(Standard), `WDSW3100D0004` (expired), `WDRT8800E0005` (Narmada, Premium). All products and organisations are fictitious.

## Develop without Docker

Needs Node 22, pnpm 10, PostgreSQL 16 and Redis 7.

```bash
pnpm install
psql -U postgres -f deploy/postgres/00-roles.sql     # roles + database
pnpm --filter "./packages/*" build
pnpm db:migrate && pnpm db:seed
node apps/web/e2e/mock-oidc.mjs &                     # stand-in IdP on :8080 (no Keycloak needed)
pnpm --filter @wd/api dev & pnpm --filter @wd/api dev:worker & pnpm --filter @wd/web dev
```

## Repository

```
apps/api        NestJS modular monolith (HTTP API + worker entrypoint), SQL migrations in db/
apps/web        Next.js App Router portal + BFF (session, OIDC, API proxy), Playwright E2E in e2e/
packages/contracts   Zod schemas: API validation, OpenAPI and web types from one source
packages/rbac        RBAC matrix (rbac.matrix.yaml) + CASL ability builder
packages/sla-time    Business-hours arithmetic for SLA clocks
packages/ui          Design system (tokens, components, Storybook)
packages/brand-lint  Prohibited-brand scanner for code, builds and rendered pages
packages/config      Typed environment schemas
deploy/              Postgres bootstrap, Keycloak realm, Dockerfiles
docs/                Architecture, ADRs, Phase 2 report, runbooks, ASVS mapping
```

## Tests

| Command | What it proves |
|---|---|
| `pnpm -r test` | Unit tests: SLA arithmetic (incl. property tests), RBAC, secret masking, sanitising, templates, brand-lint |
| `TEST_PG_ADMIN_URL=postgres://postgres@localhost/postgres pnpm test:integration` | Real Postgres: tenant isolation through API **and** raw SQL, generated RBAC matrix, full case lifecycle, email-to-case, audit chain |
| `pnpm --filter @wd/web exec playwright test` | Browser E2E of the MVP flow + axe WCAG 2.1 AA on public pages (desktop + mobile) |
| `WD_PROHIBITED_TERMS=… pnpm brand-lint` | Zero prohibited brand names in source, builds, rendered pages |

Conventional commits are enforced in CI (`commitlint`). Keep PRs small.
