-- 0017: portal settings that staff change without a release (contact details, feature switches).
CREATE TABLE portal_setting (
  key         text PRIMARY KEY CHECK (key ~ '^[a-zA-Z][a-zA-Z0-9]{1,40}$'),
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES app_user (id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE portal_setting ENABLE ROW LEVEL SECURITY;
-- Every value here is shown publicly (phone numbers, hours, switches); only staff change them.
CREATE POLICY portal_setting_read ON portal_setting FOR SELECT USING (true);
CREATE POLICY portal_setting_write ON portal_setting FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());
GRANT SELECT, INSERT, UPDATE ON portal_setting TO wd_app;
