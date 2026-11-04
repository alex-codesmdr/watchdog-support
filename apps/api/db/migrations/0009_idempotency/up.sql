-- 0009: Idempotency-Key for case creation. A retried request (flaky mobile network, double click)
-- returns the case created by the first attempt instead of opening a duplicate P1.
CREATE TABLE idempotency_key (
  user_id      uuid NOT NULL REFERENCES app_user (id),
  key          text NOT NULL CHECK (key ~ '^[A-Za-z0-9_-]{8,128}$'),
  request_hash text NOT NULL,
  case_id      uuid REFERENCES support_case (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_key_age_idx ON idempotency_key (created_at);
ALTER TABLE idempotency_key ENABLE ROW LEVEL SECURITY;
CREATE POLICY idempotency_own ON idempotency_key FOR ALL
  USING (user_id = wd.current_user_id()) WITH CHECK (user_id = wd.current_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_key TO wd_app;
