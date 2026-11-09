# WatchDog Support Portal: handover

For Apollo Infoways Pvt. Ltd. Everything customer-facing is branded WatchDog only.

This is the one document to read before hosting the portal or handing it to a team that will run it.
Detail lives in the documents it links to.

## 1. What the portal does

| Area               | For whom                                                 | What it does                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public site        | Anyone                                                   | Search and read the knowledge base, ask the help assistant, download centre, security advisories (with RSS and email alerts), warranty check, service status, organisation registration            |
| Customer portal    | Customer users and administrators                        | Open and follow cases with SLA clocks, devices and coverage, hardware replacements (RMA), support reports, activity log, team management, API keys and webhooks, email language (English or Hindi) |
| Engineer workspace | L1, L2 and L3 engineers                                  | Case queue sorted by SLA time left, saved views, bulk assignment, saved replies, internal notes, collision warnings, customer panel, time logging, Jira issues                                     |
| Admin              | Support managers, content editors, system administrators | Case routing rules, announcements, service status, portal settings, registrations, device import, advisories, releases, knowledge base editor, audit trail with tamper check                       |

Phase reports with the detail: [PHASE2](PHASE2.md), [PHASE3](PHASE3.md), [PHASE4](PHASE4.md), [PHASE5](PHASE5.md).
Architecture: [ARCHITECTURE](ARCHITECTURE.md). Decisions and their reasons: [ADR](ADR.md).

## 2. Running it on a computer for review

Plain-language steps: [RUN_ON_YOUR_COMPUTER](RUN_ON_YOUR_COMPUTER.md). In short:

```bash
git clone https://github.com/alex-codesmdr/watchdog-support.git
cd watchdog-support
cp .env.example .env        # Windows PowerShell: copy .env.example .env
docker compose up -d --build
```

Then open http://localhost:3000. Demo accounts are listed in the [README](../README.md).

## 3. What you need before hosting

These are decisions and accounts only Apollo Infoways can provide.

| Item                                  | Why                                    | Notes                                                                                                                 |
| ------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Domain, e.g. `support.watchdog…`      | The portal's address                   | Plus a sub-domain for sign-in, e.g. `id.…`                                                                            |
| Server or cloud account in India      | Runs the portal                        | 4 vCPU and 16 GB RAM is enough to start; managed PostgreSQL 16 and Redis 7 recommended. Keep data in India (DPDP Act) |
| Object storage (S3-compatible)        | Attachments, firmware files, RMA forms | Any S3-compatible store; the Docker setup uses SeaweedFS                                                              |
| Email sending (SMTP)                  | Case emails, invitations, alerts       | A domain mailbox with SPF, DKIM and DMARC set up                                                                      |
| Email receiving (IMAP)                | Customers reply to case emails         | A mailbox such as `case@…`                                                                                            |
| Sign-in server (Keycloak)             | Passwords and two-step verification    | Included in the Docker setup; host it with the portal                                                                 |
| Real support phone numbers and emails | Shown on the site                      | Set them in Admin > Portal settings; no release needed                                                                |
| Product list                          | Real model names                       | The demo uses invented names; import the real catalogue                                                               |
| Jira (optional)                       | Engineering issues                     | A Jira Cloud project and an API token                                                                                 |
| AI provider key (optional)            | Fuller assistant answers               | Without it the assistant quotes article passages                                                                      |
| SMS provider (optional)               | Urgent alerts by SMS                   | Not connected yet; the adapter is ready for one                                                                       |
| Penetration test                      | Independent security check             | Recommended before going live                                                                                         |

## 4. Production settings

Copy `.env.example`, then change every value marked below. The API **refuses to start** in production if
any of the starred items are left at development values.

| Setting                           | Set to                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                        | `production`                                                                                            |
| `SEED_DEMO`                       | `false`: loads product families, SLA targets, queues, roles and starter articles, but no demo customers |
| `APP_SIGNING_KEY` ★               | A fresh random value, 64+ characters (`openssl rand -base64 48`). Never reuse the development key       |
| `DATABASE_URL`, `REDIS_URL`       | Your managed database and Redis                                                                         |
| `STORAGE_DRIVER` ★                | `s3`, with `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`                                 |
| `AV_MODE` ★                       | `clamav` (virus scanning of every upload)                                                               |
| `IDENTITY_PROVISIONER` ★          | `keycloak`, with the admin client secret                                                                |
| `AUTH_REQUIRE_MFA` ★              | `true`                                                                                                  |
| `SMTP_HOST`, `MAIL_FROM` ★        | Your real mail server and sender                                                                        |
| `IMAP_*`                          | The reply mailbox                                                                                       |
| `WEBHOOK_ALLOW_PRIVATE_TARGETS` ★ | `false`                                                                                                 |
| `PUBLIC_WEB_URL`                  | `https://` address of the portal                                                                        |
| `SESSION_COOKIE_SECURE` ★         | `true` (checked when the site is served over https)                                                     |
| `OIDC_CLIENT_SECRET` ★            | The web client secret from Keycloak                                                                     |
| `JIRA_MODE`                       | `cloud` plus `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`; or leave `mock`       |
| `ASSISTANT_MODE`                  | `extractive` (default) or `anthropic` with `ANTHROPIC_API_KEY`                                          |
| `RMA_RETURN_ADDRESS`              | Already set to the Noida address; change if it moves                                                    |

## 5. First day after going live

1. Sign in to Keycloak's admin console and change its admin password.
2. Create the first WatchDog system administrator in Keycloak and grant `system_admin`.
3. In the portal: Admin > Portal settings: real phone numbers, hours and emails.
4. Admin > Device import: import customer devices and contracts from the spreadsheet template.
5. Admin > Case routing: add rules so new cases reach the right engineers.
6. Review the starter knowledge base articles: edit, keep or unpublish each one.
7. Admin > Service status: check every service shows "Working normally".

## 6. Running it day to day

Runbook: [operations](runbooks/operations.md). The essentials:

- **Health**: `/healthz` (process up) and `/readyz` (database, Redis, storage reachable) on the API.
- **Backups**: set up daily PostgreSQL backups kept at least 35 days, and versioning on object storage.
  Test a restore every quarter.
- **Audit trail**: Admin > Audit trail > "Check the trail has not been altered" recomputes the hash chain.
- **Background worker**: one `worker` process sends emails, runs SLA timers, retries webhooks, syncs Jira
  and sends coverage reminders. It must always be running.
- **Updates**: deploy the API and worker together; migrations run first and are forward-only.
- **Security incidents**: report to CERT-In within 6 hours (see the runbook).

## 7. Brand rule

Only "WatchDog" may appear anywhere customers can see. Third-party vendor names are blocked by:

- CI (`pnpm brand-lint`) on source, builds and rendered pages;
- the API, which refuses to publish articles, advisories, releases, announcements, status updates and
  saved replies containing one.

The blocked names are stored only as one-way fingerprints in `packages/brand-lint/prohibited.sha256`,
so the names themselves never appear in the repository. An internal-only product mapping field exists
for staff and is never shown to customers.

## 8. Known limits and accepted risks

| Item                                                  | Status                                                                                                                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portal pages are English; emails are English or Hindi | Hindi pages need translated page text; the message catalogue is ready                                                                                                                                            |
| SMS alerts                                            | Adapter in place, no provider connected                                                                                                                                                                          |
| Dependency findings (`pnpm audit --prod`)             | 2 moderate, not reachable: `glob` and `minimatch` are used only by the email template tool's command line, which the portal never runs (`uuid` in the spreadsheet library was upgraded). Recheck at each release |
| Help assistant                                        | Answers only from published articles; it can miss details, and the page says so                                                                                                                                  |
| Status page                                           | Updated by staff; it does not monitor services by itself                                                                                                                                                         |

## 9. Where things are

```
apps/api       API and background worker; database migrations in db/migrations
apps/web       Website and its sign-in layer; browser tests in e2e/
packages/*     Shared definitions, permissions, design system, brand checks, settings
deploy/        Docker images, database roles, Keycloak realm
docs/          This guide, phase reports, architecture, decisions, runbooks, security mapping
```

Tests: about 540 API and unit tests and about 70 browser tests, run by GitHub on every change, including
a full run against the real sign-in server and virus scanner.
