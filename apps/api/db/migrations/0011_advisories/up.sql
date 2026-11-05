-- 0011 security advisories (WDSA), affected WatchDog products, subscriptions.

CREATE SEQUENCE advisory_number_seq;
CREATE FUNCTION wd.next_advisory_id() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'WDSA-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('advisory_number_seq')::text, 4, '0')
$$;

CREATE TABLE advisory (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wd_id         text NOT NULL UNIQUE DEFAULT wd.next_advisory_id(),
  title         text NOT NULL CHECK (length(title) BETWEEN 5 AND 200),
  summary       text NOT NULL CHECK (length(summary) BETWEEN 10 AND 1000),
  severity      text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'informational')),
  cvss_score    numeric(3, 1) CHECK (cvss_score BETWEEN 0 AND 10),
  cvss_vector   text CHECK (cvss_vector ~ '^CVSS:3\.[01]/[A-Z:/]+$'),
  cve_ids       text[] NOT NULL DEFAULT '{}' CHECK (array_position(cve_ids, NULL) IS NULL),
  body_md       text NOT NULL DEFAULT '' CHECK (length(body_md) <= 100000),
  body_html     text NOT NULL DEFAULT '',
  workaround_md text NOT NULL DEFAULT '' CHECK (length(workaround_md) <= 20000),
  workaround_html text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'withdrawn')),
  revision      int NOT NULL DEFAULT 0,
  revision_note text,
  created_by    uuid NOT NULL REFERENCES app_user (id),
  published_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER advisory_touch BEFORE UPDATE ON advisory FOR EACH ROW EXECUTE FUNCTION wd.touch_updated_at();
CREATE INDEX advisory_published_idx ON advisory (published_at DESC) WHERE status = 'published';
ALTER TABLE advisory ENABLE ROW LEVEL SECURITY;
CREATE POLICY advisory_read ON advisory FOR SELECT USING (wd.is_internal() OR status IN ('published', 'withdrawn'));
CREATE POLICY advisory_write ON advisory FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());

CREATE TABLE advisory_affected (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advisory_id     uuid NOT NULL REFERENCES advisory (id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES product (id),
  affected_versions text NOT NULL CHECK (length(affected_versions) BETWEEN 1 AND 200),
  fixed_version   text CHECK (length(fixed_version) <= 60),
  UNIQUE (advisory_id, product_id)
);
ALTER TABLE advisory_affected ENABLE ROW LEVEL SECURITY;
CREATE POLICY advisory_affected_read ON advisory_affected FOR SELECT
  USING (EXISTS (SELECT 1 FROM advisory a WHERE a.id = advisory_id));
CREATE POLICY advisory_affected_write ON advisory_affected FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());

-- PSIRT working notes (upstream references, reporter contact). Staff only, never in any response
-- to a customer session: separate table + RLS rather than a column.
CREATE TABLE advisory_internal (
  advisory_id uuid PRIMARY KEY REFERENCES advisory (id) ON DELETE CASCADE,
  notes       text NOT NULL DEFAULT '' CHECK (length(notes) <= 20000)
);
ALTER TABLE advisory_internal ENABLE ROW LEVEL SECURITY;
CREATE POLICY advisory_internal_staff ON advisory_internal FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());

CREATE TABLE advisory_subscription (
  user_id      uuid PRIMARY KEY REFERENCES app_user (id) ON DELETE CASCADE,
  family_ids   uuid[] NOT NULL DEFAULT '{}', -- empty = every family
  min_severity text NOT NULL DEFAULT 'medium' CHECK (min_severity IN ('critical', 'high', 'medium', 'low', 'informational')),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE advisory_subscription ENABLE ROW LEVEL SECURITY;
CREATE POLICY advisory_subscription_own ON advisory_subscription FOR ALL
  USING (wd.is_internal() OR user_id = wd.current_user_id())
  WITH CHECK (user_id = wd.current_user_id());

GRANT SELECT, INSERT, UPDATE ON advisory TO wd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON advisory_affected TO wd_app;
GRANT SELECT, INSERT, UPDATE ON advisory_internal TO wd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON advisory_subscription TO wd_app;
GRANT USAGE ON SEQUENCE advisory_number_seq TO wd_app;
GRANT EXECUTE ON FUNCTION wd.next_advisory_id TO wd_app;
