# Phase 2 report: foundation and case-management MVP

Date: 2026-11-04 · Scope approved in Phase 1 · Next: Phase 3 (SLA engine, assets/entitlements, KB, search, downloads)

## Delivered

| Area                            | What exists                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository & tooling            | pnpm + Turborepo monorepo, TypeScript strict everywhere, ESLint (incl. module-boundary rules), Prettier, commitlint, `.env.example`, reversible SQL migrations                                                                                                                                                                                                               |
| CI (`.github/workflows/ci.yml`) | lint/format/typecheck/unit, Storybook build, integration on Postgres, E2E + axe + Lighthouse ≥ 90, brand scan of source and rendered pages, gitleaks, `pnpm audit`, Trivy (fs + image), CycloneDX SBOM, image builds, E2E against real Keycloak via compose                                                                                                                  |
| Local stack                     | `docker compose up`: Postgres, Redis, Keycloak (MFA realm), MinIO, ClamAV, Mailpit, migrate+seed, API, worker, web                                                                                                                                                                                                                                                           |
| Identity                        | Keycloak realm with password + TOTP step-up (`acr=mfa`), brute-force lockout, password policy; BFF with server-side tokens, HttpOnly session cookie, CSRF token + Origin check, PKCE, nonce, refresh, RP-initiated logout; API requires MFA-level tokens and resolves roles from **its own** database                                                                        |
| Onboarding                      | Public registration with DPDP consent record (no account enumeration, rate-limited) → system-admin approval → Keycloak user + set-up email via worker                                                                                                                                                                                                                        |
| Tenant isolation                | Postgres RLS on every tenant table, fail-closed GUCs, non-owner app role with boot-time assertion, internal-note visibility enforced in SQL, column privilege hiding OEM mapping, CASL inner wall, 404 for foreign resources                                                                                                                                                 |
| RBAC                            | `rbac.matrix.yaml` drives seeds, abilities and a **generated** authorization suite (every endpoint × every role, plus every external role × every tenant endpoint on a foreign org)                                                                                                                                                                                          |
| Cases                           | Guided 4-step creation with serial/entitlement validation and similar-case suggestions; list/search/pagination; thread with public replies and internal notes; status lifecycle with staff/customer transition rules; L1→L2→L3→Engineering escalation; customer escalation with justification; assign; optimistic concurrency (`If-Match`); CSAT in-app and by emailed token |
| Attachments                     | tus resumable uploads (8 MB chunks, 2 GB limit) to quarantine; magic-byte executable rejection; ClamAV INSTREAM; secret masking for configs/logs (original kept separately); 5-minute signed download URLs, `Content-Disposition: attachment`                                                                                                                                |
| SLA (basic)                     | Policy per tier × severity with IST business calendar + 2026 DoP&T holidays, 24×7 for Mission-Critical P1/P2; clocks start/meet/pause/resume; budget bars in UI. Breach worker and escalation rules are Phase 3                                                                                                                                                              |
| Notifications                   | Transactional outbox → BullMQ; MJML emails (case opened, update, status, resolved + CSAT, escalation, registration); reply-to tokens; SMS adapter (mock, DLT-shaped) for P1                                                                                                                                                                                                  |
| Email-to-case                   | Signed reply token / subject threading, sender verification (org or delegated partner), quoted-text stripping, idempotent by Message-ID, auto-reply loop guard, hold queue for anything doubtful; IMAP poller                                                                                                                                                                |
| Audit                           | Append-only, hash-chained, monthly-partitionable audit log written in the same transaction as each change; `wd.audit_verify()` detects tampering                                                                                                                                                                                                                             |
| Web                             | Landing page, registration, customer dashboard and cases, engineer queue and workspace, admin approvals, CSAT page; strict CSP with nonces; empty/loading/error states; light/dark; mobile-first                                                                                                                                                                             |
| Design system                   | Tokens as CSS variables, components in `packages/ui`, Storybook with a11y addon                                                                                                                                                                                                                                                                                              |
| API docs                        | OpenAPI 3.1 generated from the Zod contracts with examples; `/api/docs` (non-production)                                                                                                                                                                                                                                                                                     |

## Verification run for this hand-over

| Check                                                                                             | Result                                                     |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Unit tests (packages, API, web)                                                                   | 61 passed                                                  |
| Integration tests on PostgreSQL 16 (RLS, generated RBAC matrix, lifecycle)                        | 179 passed                                                 |
| Playwright E2E + axe (desktop + mobile) against the built app                                     | 23 passed                                                  |
| Lighthouse (mobile, simulated 4G) on `/`, `/register`, `/search`, `/products/switching`           | Accessibility 100, Performance 94–99, Best practices 93–96 |
| Brand scan with the prohibited OEM names over source, `.next`, API build, rendered pages, OpenAPI | 0 findings                                                 |
| Migrations up → down → up                                                                         | Clean                                                      |
| ESLint, Prettier, `tsc --noEmit` (all workspaces), Storybook build                                | Clean                                                      |

Not executed in this environment (no container runtime): `docker compose up`, image builds, ClamAV and
MinIO integration, and the Keycloak realm itself. These are covered by the `images` and `e2e-keycloak`
CI jobs. **Treat their first green run as the gate before calling Phase 2 done.**

## MVP acceptance criteria

| #   | Criterion                                                                                    | Status                                                                        |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Register → approval → MFA login → P1 case with attachments → email confirmation → SLA timers | **Met** (integration + browser E2E with mock IdP; Keycloak path in CI)        |
| 2   | Engineer triages, replies, internal note, escalates, resolves; customer notified; CSAT       | **Met** (integration; browser E2E covers triage/note/reply)                   |
| 3   | Org A can never access Org B cases/assets/files, proven by tests                             | **Met**: 42 isolation tests (API + raw SQL) + generated foreign-tenant matrix |
| 4   | Serial warranty lookup, rate-limited                                                         | Phase 3 (DB function and rate limiter exist; public endpoint + CAPTCHA next)  |
| 5   | KB search < 500 ms on 10,000 articles                                                        | Phase 3                                                                       |
| 6   | Zero prohibited brand names in code and rendered pages                                       | **Met** for everything built so far; enforced in CI                           |
| 7   | Lighthouse accessibility ≥ 90 on public pages                                                | **Met** (100)                                                                 |
| 8   | One-command `docker compose up` with seeded data                                             | Built; **pending first CI run** (see above)                                   |

## Decisions taken in this phase

- The four Phase 1 review questions were taken as approved with their defaults: the seeded SLA targets, globally unique serial numbers, Customer Admins may see their own organisation's audit events (permission exists; the viewer screen is Phase 4), and 404 for foreign resources.

- **ADR-017** RLS is enabled, not forced, so narrow `SECURITY DEFINER` functions work; the API refuses to start as an owner/bypass role.
- **ADR-018** The OEM mapping column is not even readable by the app role (column privilege).
- **ADR-019** Fonts are self-hosted for air-gapped installs.
- **ADR-020** A mock OIDC provider keeps E2E fast; Keycloak E2E runs in CI.
- **ADR-021** Kysely types are hand-written until codegen lands.
- Customers get **403** for staff-only status changes and **409** for impossible ones; foreign resources are always **404**.
- Customer replies automatically move "Awaiting customer" cases back to "In progress", and reopen resolved cases.
- Creating a case **by email** is not allowed. Email can only add to existing cases, because a new case needs an entitlement check.

## Known gaps carried into Phase 3

1. **i18n**: shared navigation and landing copy use `messages/en.json`; page-level strings in the case screens are still inline and move to the catalogue with the Hindi work.
2. **Email attachments**: files attached to inbound emails are not ingested yet. The case history tells the customer to upload them in the portal.
3. **SLA breach detection**: warnings (50/75/90 %), breach stamping, auto-escalation and the escalation matrix are not built yet. Clocks and due dates are correct today.
4. **Partner UI** for opening cases on behalf of a delegated customer. The API supports it; the wizard does not yet offer an organisation picker.
5. **Idempotency-Key** on POST `/cases` is designed but not implemented; double-submit is prevented in the UI only.
6. **Unmasked originals** of masked attachments are stored, but the audited L3 access path is Phase 4.
7. **Helm chart and Terraform** are not started yet (Phase 5 hardening). Only compose and Dockerfiles exist.

## Open risks

| Risk                                                                                 | Mitigation                                                                         |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Keycloak step-up flow and `acr` mapping are untested against a live server           | `e2e-keycloak` CI job; API accepts `mfa` or `2` via `AUTH_MFA_ACR_VALUES`          |
| Outbox retries can re-send an email to earlier recipients if a later recipient fails | Acceptable at-least-once for now; per-recipient outbox fan-out in Phase 3          |
| Secret-masking false negatives on vendor-specific syntax                             | Rules are tested; extend from real customer bundles (anonymised) before go-live    |
| SLA targets are seeded defaults, not contractual                                     | Confirm the Phase 1 table or send contract values                                  |
| 2027 holiday list not yet published by DoP&T                                         | Only fixed national holidays seeded for 2027; load the official list when released |
