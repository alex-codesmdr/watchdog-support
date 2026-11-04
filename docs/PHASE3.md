# Phase 3 progress: SLA engine, warranty check, knowledge base

Status: **in progress**. Last updated 2026-11-04.

| Part | Status | What exists |
|---|---|---|
| 3a SLA engine | Done | Worker checks running clocks every 30 s; warnings at 50/75/90 %, breach at 100 %; rules notify assignee, managers or the named escalation matrix and auto-escalate the support level; idempotent across several workers; paused/met/resolved clocks never warn. SLA compliance and breach report for managers (`/workspace/sla`). |
| 3b Warranty check | Done | `/warranty`: public serial lookup returning coverage only; self-hosted proof-of-work CAPTCHA (single-use, 5-minute expiry); 20 lookups per hour per client. **Closes MVP criterion 4.** |
| 3c Knowledge base | Done | Six article types, four visibility levels (public, registered, partner, internal), immutable versions, draft → review → publish → archive, product and firmware tagging, feedback, related articles, "draft from resolved case", search with stemming, error codes, typo tolerance, facets and "did you mean". Article suggestions while customers type a case subject. 14 starter articles. **Closes MVP criterion 5** (p95 221–259 ms on 10,014 articles). |
| 3d Assets & entitlements | Next | Customer admins manage sites/devices, CSV/XLSX import with validation report, 90/60/30-day expiry reminders, renewal-quote request |
| 3e Download centre | Next | Entitlement-gated firmware/documents, SHA-256, signed URLs, EULA, download audit, compatibility matrix, EOL notices |
| Phase 2 gaps | Next | Email attachments into cases, partner organisation picker, page text into the message catalogue, Idempotency-Key |

## Decisions
- **ADR-022** Local storage uses SeaweedFS because MinIO stopped publishing images; production can use any S3 API.
- **ADR-023** Knowledge-base search runs in PostgreSQL (amends ADR-007), with measured evidence; OpenSearch remains an adapter option.
- The SLA monitor relies on a 30-second check rather than per-clock timers. Alerts can be up to 30 seconds late, which is acceptable against 15-minute targets and simpler to operate.
- Articles drafted from cases start **internal** and carry a reminder to remove customer details before publishing.

## Tests at this point
241 API integration tests (including 9 SLA, 5 warranty, 18 knowledge-base with the 10k performance test), 21 API unit tests, 38 browser tests on desktop and mobile with axe accessibility checks.
