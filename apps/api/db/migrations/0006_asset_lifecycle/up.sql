-- 0006 asset lifecycle: renewal requests, expiry reminder ledger, import history.

-- A customer asks WatchDog for a renewal quote. Tenant data.
CREATE TABLE renewal_request (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organization (id),
  asset_id       uuid NOT NULL REFERENCES asset (id),
  entitlement_id uuid REFERENCES entitlement (id),
  requested_by   uuid NOT NULL REFERENCES app_user (id),
  desired_tier   text CHECK (desired_tier IS NULL OR desired_tier IN ('standard', 'premium', 'mission_critical')),
  note           text CHECK (length(note) <= 2000),
  status         text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'quoted', 'won', 'lost', 'cancelled')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX renewal_request_org_idx ON renewal_request (org_id, created_at DESC);
-- At most one open request per asset (prevents duplicate quotes).
CREATE UNIQUE INDEX renewal_request_open_uq ON renewal_request (asset_id) WHERE status = 'requested';
ALTER TABLE renewal_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY renewal_read ON renewal_request FOR SELECT USING (wd.can_see_org(org_id));
CREATE POLICY renewal_insert ON renewal_request FOR INSERT WITH CHECK (wd.is_internal() OR org_id = wd.current_org());
CREATE POLICY renewal_update ON renewal_request FOR UPDATE USING (wd.is_internal()) WITH CHECK (wd.is_internal());

-- Ledger of expiry reminders already sent (90/60/30 days), so the daily job never repeats one.
CREATE TABLE entitlement_reminder (
  entitlement_id uuid NOT NULL REFERENCES entitlement (id) ON DELETE CASCADE,
  days_before    smallint NOT NULL CHECK (days_before IN (90, 60, 30)),
  sent_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entitlement_id, days_before)
);
ALTER TABLE entitlement_reminder ENABLE ROW LEVEL SECURITY;
CREATE POLICY entitlement_reminder_staff ON entitlement_reminder FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());

-- Bulk import history (staff). The validation report is kept for audit and re-download.
CREATE TABLE asset_import (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by  uuid NOT NULL REFERENCES app_user (id),
  file_name    text NOT NULL,
  dry_run      boolean NOT NULL,
  total_rows   int NOT NULL,
  created      int NOT NULL DEFAULT 0,
  updated      int NOT NULL DEFAULT 0,
  failed       int NOT NULL DEFAULT 0,
  report       jsonb NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE asset_import ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_import_staff ON asset_import FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());

GRANT SELECT, INSERT, UPDATE ON renewal_request TO wd_app;
GRANT SELECT, INSERT ON entitlement_reminder TO wd_app;
GRANT SELECT, INSERT ON asset_import TO wd_app;
GRANT DELETE ON site TO wd_app;
