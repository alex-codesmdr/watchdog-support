-- 0010 RMA: replacement of faulty devices, raised from a support case.

CREATE SEQUENCE rma_number_seq;
CREATE FUNCTION wd.next_rma_number() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'RMA-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('rma_number_seq')::text, 6, '0')
$$;

CREATE TABLE rma (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number             text NOT NULL UNIQUE DEFAULT wd.next_rma_number(),
  org_id             uuid NOT NULL REFERENCES organization (id),
  case_id            uuid NOT NULL REFERENCES support_case (id),
  asset_id           uuid NOT NULL REFERENCES asset (id),
  type               text NOT NULL CHECK (type IN ('standard', 'advance')),
  status             text NOT NULL DEFAULT 'requested' CHECK (status IN
                       ('requested', 'approved', 'return_in_transit', 'received', 'replacement_shipped', 'closed', 'rejected', 'cancelled')),
  fault_description  text NOT NULL CHECK (length(fault_description) BETWEEN 10 AND 4000),
  contact_name       text NOT NULL,
  contact_phone      text NOT NULL,
  address            text NOT NULL,
  city               text NOT NULL,
  state              text NOT NULL,
  pincode            text NOT NULL CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  replacement_serial text,
  replacement_asset_id uuid REFERENCES asset (id),
  outbound_courier   text,
  outbound_tracking  text,
  inbound_courier    text,
  inbound_tracking   text,
  shipped_at         timestamptz,
  received_at        timestamptz,
  requested_by       uuid NOT NULL REFERENCES app_user (id),
  version            int NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER rma_touch BEFORE UPDATE ON rma FOR EACH ROW EXECUTE FUNCTION wd.touch_updated_at();
CREATE INDEX rma_org_idx ON rma (org_id, created_at DESC);
CREATE INDEX rma_case_idx ON rma (case_id);
CREATE INDEX rma_status_idx ON rma (status) WHERE status NOT IN ('closed', 'rejected', 'cancelled');
-- One open RMA per device.
CREATE UNIQUE INDEX rma_open_asset_uq ON rma (asset_id)
  WHERE status NOT IN ('closed', 'rejected', 'cancelled');
ALTER TABLE rma ENABLE ROW LEVEL SECURITY;
CREATE POLICY rma_read ON rma FOR SELECT USING (wd.can_see_org(org_id));
CREATE POLICY rma_write ON rma FOR INSERT WITH CHECK (wd.can_see_org(org_id));
CREATE POLICY rma_update ON rma FOR UPDATE USING (wd.can_see_org(org_id)) WITH CHECK (wd.can_see_org(org_id));

CREATE TABLE rma_event (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rma_id     uuid NOT NULL REFERENCES rma (id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES organization (id),
  from_status text,
  to_status  text NOT NULL,
  actor_id   uuid REFERENCES app_user (id),
  note       text CHECK (length(note) <= 2000),
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rma_event_rma_idx ON rma_event (rma_id, at);
ALTER TABLE rma_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY rma_event_read ON rma_event FOR SELECT USING (wd.can_see_org(org_id));
CREATE POLICY rma_event_insert ON rma_event FOR INSERT WITH CHECK (wd.can_see_org(org_id));

-- A returned device stays on record (history, audits) but no longer counts as installed.
ALTER TABLE asset ADD COLUMN retired_at timestamptz;

GRANT SELECT, INSERT, UPDATE ON rma TO wd_app;
GRANT SELECT, INSERT ON rma_event TO wd_app;
GRANT USAGE ON SEQUENCE rma_number_seq TO wd_app;
GRANT EXECUTE ON FUNCTION wd.next_rma_number TO wd_app;
