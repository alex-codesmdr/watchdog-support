-- 0018: engineer workspace: time logged on cases, and saved queue filters.

CREATE TABLE case_time_entry (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organization (id),
  case_id     uuid NOT NULL REFERENCES support_case (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user (id),
  minutes     integer NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  note        text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  worked_on   date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER case_time_entry_org BEFORE INSERT ON case_time_entry FOR EACH ROW EXECUTE FUNCTION wd.inherit_case_org();
CREATE INDEX case_time_entry_case_idx ON case_time_entry (case_id, created_at);
CREATE INDEX case_time_entry_user_idx ON case_time_entry (user_id, worked_on);
ALTER TABLE case_time_entry ENABLE ROW LEVEL SECURITY;
-- Staff-only: customers are never shown effort.
CREATE POLICY case_time_entry_staff ON case_time_entry FOR SELECT USING (wd.is_internal());
CREATE POLICY case_time_entry_insert ON case_time_entry FOR INSERT
  WITH CHECK (wd.is_internal() AND user_id = wd.current_user_id());
CREATE POLICY case_time_entry_delete ON case_time_entry FOR DELETE
  USING (wd.is_internal() AND user_id = wd.current_user_id());
GRANT SELECT, INSERT, DELETE ON case_time_entry TO wd_app;

CREATE TABLE saved_view (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  params      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);
ALTER TABLE saved_view ENABLE ROW LEVEL SECURITY;
CREATE POLICY saved_view_owner ON saved_view FOR ALL
  USING (owner_id = wd.current_user_id()) WITH CHECK (owner_id = wd.current_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_view TO wd_app;
