-- 0004 SLA escalation: warning/breach rules and the named escalation matrix (design §6.4).

-- What happens when a running clock crosses a threshold (50/75/90/100 % of its budget).
-- NULL tier/severity/metric = applies to all. Global configuration (no tenant data).
CREATE TABLE escalation_rule (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier       text CHECK (tier IS NULL OR tier IN ('standard', 'premium', 'mission_critical')),
  severity   text CHECK (severity IS NULL OR severity IN ('P1', 'P2', 'P3', 'P4')),
  metric     text CHECK (metric IS NULL OR metric IN ('first_response', 'update', 'restoration', 'resolution')),
  threshold  smallint NOT NULL CHECK (threshold IN (50, 75, 90, 100)),
  action     text NOT NULL CHECK (action IN ('notify_assignee', 'notify_managers', 'notify_matrix', 'escalate_level')),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX escalation_rule_threshold_idx ON escalation_rule (threshold) WHERE active;

-- Named escalation matrix: who is called at each management level, per tier (and optionally region).
CREATE TABLE escalation_contact (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier       text CHECK (tier IS NULL OR tier IN ('standard', 'premium', 'mission_critical')),
  level      smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  region     text,
  name       text NOT NULL,
  title      text NOT NULL,
  email      citext NOT NULL,
  phone      text,
  active     boolean NOT NULL DEFAULT true
);
CREATE INDEX escalation_contact_tier_idx ON escalation_contact (tier, level) WHERE active;

GRANT SELECT ON escalation_rule, escalation_contact TO wd_app;

-- Running clocks are scanned by the SLA worker; this index serves "not met, not paused, not fully warned".
CREATE INDEX sla_clock_running_idx ON sla_clock (case_id) WHERE met_at IS NULL AND paused_at IS NULL AND last_warn_pct < 100;
