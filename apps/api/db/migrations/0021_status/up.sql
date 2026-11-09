-- 0021: public service status page: components, incidents and their updates.
CREATE TABLE status_component (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 80),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 200),
  position    integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'operational'
              CHECK (status IN ('operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance')),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE status_incident (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL CHECK (length(title) BETWEEN 5 AND 140),
  impact       text NOT NULL CHECK (impact IN ('minor', 'major', 'critical', 'maintenance')),
  status       text NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved', 'scheduled', 'in_progress', 'completed')),
  component_ids uuid[] NOT NULL DEFAULT '{}',
  started_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  created_by   uuid NOT NULL REFERENCES app_user (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX status_incident_started_idx ON status_incident (started_at DESC);
CREATE TABLE status_update (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES status_incident (id) ON DELETE CASCADE,
  status      text NOT NULL,
  body        text NOT NULL CHECK (length(body) BETWEEN 5 AND 2000),
  by_user     uuid NOT NULL REFERENCES app_user (id),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX status_update_incident_idx ON status_update (incident_id, at);

ALTER TABLE status_component ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_incident ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_update ENABLE ROW LEVEL SECURITY;
-- Everything here is public by design; only staff write.
CREATE POLICY status_component_read ON status_component FOR SELECT USING (true);
CREATE POLICY status_component_write ON status_component FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());
CREATE POLICY status_incident_read ON status_incident FOR SELECT USING (true);
CREATE POLICY status_incident_write ON status_incident FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());
CREATE POLICY status_update_read ON status_update FOR SELECT USING (true);
CREATE POLICY status_update_write ON status_update FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());
GRANT SELECT, INSERT, UPDATE ON status_component, status_incident TO wd_app;
GRANT SELECT, INSERT ON status_update TO wd_app;

INSERT INTO status_component (name, description, position) VALUES
  ('Support portal', 'This website: cases, devices, knowledge base', 10),
  ('Case email', 'Case notifications and replies by email', 20),
  ('Download centre', 'Firmware, software and documents', 30),
  ('P1 phone line', 'The 24×7 outage line', 40),
  ('Device registration and warranty', 'Serial number checks and coverage', 50);
