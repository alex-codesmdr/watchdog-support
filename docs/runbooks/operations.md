# Runbook: operations

## Deploy order
1. `node dist/db/setup.js` (migrate + reference data; `SEED=false` in production) with `DATABASE_OWNER_URL` (migrations job; the owner secret is **only** mounted here).
2. Roll API and worker (same image, `node dist/src/main.js` / `node dist/src/worker.js`). Both refuse to start as an owner/RLS-bypass role.
3. Roll web.
Rollback: redeploy previous images; `migrate.js down 1` only if the migration notes say it is safe (data-destructive downs are flagged in review).

## Health
- Liveness `GET /healthz`, readiness `GET /readyz` (DB + Redis). Metrics: `:9464/metrics` (internal network only).
- Worker health: BullMQ queues `notifications`, `file-scan`; outbox backlog = `SELECT count(*) FROM outbox_event WHERE published_at IS NULL` (alert > 500 or oldest > 5 min).
- Parked events (failed 8 times): `SELECT topic, last_error FROM outbox_event WHERE published_at = 'infinity'`. Fix the cause, then `UPDATE … SET published_at = NULL, attempts = 0, available_at = now()`.

## ClamAV down
Uploads stay **quarantined** (`scan_status = pending`), never served. Restore clamd; the worker retries with backoff. If the job exhausted retries, re-enqueue: insert an `attachment.scan` outbox row for each pending attachment.

## Inbound email held for review
`SELECT * FROM inbound_email_hold WHERE resolved_at IS NULL`. Reasons: `unverified-sender` (possible spoofing: confirm with the customer), `invalid-reply-token` (forged or corrupted), `no-case-reference`, `case-closed`, `auto-generated`. Staff UI for this queue is Phase 4.

## Audit log integrity
`SELECT wd.audit_verify();` as the owner returns `NULL` when the chain is intact, otherwise the first bad sequence number. Run daily (cron job) and alert on non-NULL. Create next month's partition ahead of time: `SELECT wd.ensure_audit_partition(date_trunc('month', now()) + interval '1 month');`. Retention: minimum 180 days in India (CERT-In).

## Rotating `APP_SIGNING_KEY`
It signs email reply tokens, CSAT links and filesystem download URLs. Rotation invalidates outstanding CSAT links and reply-to addresses in old emails (those replies land in the hold queue). Rotate during low traffic and announce it.

## Security incident (CERT-In 6-hour reporting)
1. Declare the incident, preserve logs and the audit log (do not truncate).
2. Within 6 hours of detection, report to CERT-In (incident@cert-in.org.in) using the prescribed format; the DPDP Board notification follows for personal-data breaches.
3. Identify affected organisations from `audit_log` (`org_id`) and notify their admins.
The workflow screen for this is Phase 4. Until then the security lead owns this checklist.
