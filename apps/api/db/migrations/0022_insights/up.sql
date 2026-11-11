-- 0022: cases logged from phone calls, follow-up of low satisfaction ratings, monthly review ledger.
ALTER TABLE support_case ADD COLUMN channel text NOT NULL DEFAULT 'web'
  CHECK (channel IN ('web', 'email', 'phone', 'api'));
ALTER TABLE case_message DROP CONSTRAINT IF EXISTS case_message_source_check;
ALTER TABLE case_message ADD CONSTRAINT case_message_source_check
  CHECK (source IN ('web', 'email', 'api', 'system', 'phone'));

-- A rating of 1 or 2 out of 5 asks a support manager to call the customer back.
ALTER TABLE csat_response
  ADD COLUMN followup_status text CHECK (followup_status IN ('needed', 'done')),
  ADD COLUMN followup_by uuid REFERENCES app_user (id),
  ADD COLUMN followup_at timestamptz,
  ADD COLUMN followup_note text CHECK (length(followup_note) <= 2000);
CREATE INDEX csat_followup_idx ON csat_response (created_at DESC) WHERE followup_status IS NOT NULL;

-- One monthly service review email per organisation and month (claimed before sending).
CREATE TABLE monthly_review (
  org_id   uuid NOT NULL REFERENCES organization (id),
  month    date NOT NULL CHECK (extract(day FROM month) = 1),
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, month)
);
ALTER TABLE monthly_review ENABLE ROW LEVEL SECURITY;
CREATE POLICY monthly_review_staff ON monthly_review FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());
GRANT SELECT, INSERT ON monthly_review TO wd_app;
