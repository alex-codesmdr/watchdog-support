-- 0019: engineering tickets raised from cases. Staff-only; customers never see tracker details.
CREATE TABLE case_jira_link (
  case_id      uuid PRIMARY KEY REFERENCES support_case (id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES organization (id),
  issue_key    text NOT NULL UNIQUE CHECK (issue_key ~ '^[A-Z][A-Z0-9]+-[0-9]+$'),
  issue_url    text NOT NULL,
  status       text NOT NULL,
  category     text NOT NULL CHECK (category IN ('new', 'indeterminate', 'done')),
  linked_by    uuid NOT NULL REFERENCES app_user (id),
  synced_at    timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER case_jira_link_org BEFORE INSERT ON case_jira_link FOR EACH ROW EXECUTE FUNCTION wd.inherit_case_org();
ALTER TABLE case_jira_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY case_jira_link_staff ON case_jira_link FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());
GRANT SELECT, INSERT, UPDATE ON case_jira_link TO wd_app;
