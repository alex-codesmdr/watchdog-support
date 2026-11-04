-- 0003 case management: queues, cases, messages, attachments, uploads, events, SLA clocks,
-- CSAT, notifications, held inbound email.

CREATE TABLE queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL UNIQUE,
  name          text NOT NULL,
  support_level smallint NOT NULL CHECK (support_level BETWEEN 1 AND 4)
);

CREATE SEQUENCE support_case_number_seq;
CREATE FUNCTION wd.next_case_number() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'WD-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('support_case_number_seq')::text, 6, '0')
$$;

CREATE TABLE support_case (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organization (id),
  number                text NOT NULL UNIQUE DEFAULT wd.next_case_number(),
  requester_id          uuid NOT NULL REFERENCES app_user (id),
  created_by            uuid NOT NULL REFERENCES app_user (id),
  asset_id              uuid REFERENCES asset (id),
  entitlement_id        uuid REFERENCES entitlement (id),
  tier                  text CHECK (tier IN ('standard', 'premium', 'mission_critical')),
  severity              text NOT NULL CHECK (severity IN ('P1', 'P2', 'P3', 'P4')),
  category              text NOT NULL CHECK (category IN ('hardware', 'software', 'config', 'performance', 'security', 'licensing', 'documentation')),
  status                text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triage', 'in_progress', 'awaiting_customer', 'awaiting_vendor', 'workaround_provided', 'resolved', 'closed', 'reopened')),
  support_level         smallint NOT NULL DEFAULT 1 CHECK (support_level BETWEEN 1 AND 4),
  assignee_id           uuid REFERENCES app_user (id),
  queue_id              uuid REFERENCES queue (id),
  sla_policy_id         uuid REFERENCES sla_policy (id),
  subject               text NOT NULL CHECK (length(subject) BETWEEN 8 AND 200),
  description_html      text NOT NULL,
  steps_tried           text,
  business_impact       text,
  software_version      text,
  search_vec            tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(number, '') || ' ' || coalesce(subject, ''))) STORED,
  opened_at             timestamptz NOT NULL DEFAULT now(),
  first_responded_at    timestamptz,
  resolved_at           timestamptz,
  closed_at             timestamptz,
  customer_escalated_at timestamptz,
  merged_into_id        uuid REFERENCES support_case (id),
  version               int NOT NULL DEFAULT 1,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (merged_into_id IS NULL OR merged_into_id <> id)
);
CREATE INDEX case_queue_idx ON support_case (status, queue_id, severity) WHERE status <> 'closed';
CREATE INDEX case_org_open_idx ON support_case (org_id, status, opened_at DESC);
CREATE INDEX case_requester_idx ON support_case (requester_id, opened_at DESC);
CREATE INDEX case_assignee_idx ON support_case (assignee_id, status);
CREATE INDEX case_search_idx ON support_case USING gin (search_vec);
CREATE INDEX case_subject_trgm_idx ON support_case USING gin (subject gin_trgm_ops);
CREATE TRIGGER support_case_touch BEFORE UPDATE ON support_case FOR EACH ROW EXECUTE FUNCTION wd.touch_updated_at();
ALTER TABLE support_case ENABLE ROW LEVEL SECURITY;
CREATE POLICY case_read ON support_case FOR SELECT USING (wd.can_see_org(org_id));
CREATE POLICY case_insert ON support_case FOR INSERT WITH CHECK (wd.can_see_org(org_id));
CREATE POLICY case_update ON support_case FOR UPDATE USING (wd.can_see_org(org_id)) WITH CHECK (wd.can_see_org(org_id));

-- Children inherit org_id from their case; the lookup itself is subject to RLS, so a caller
-- cannot attach rows to a case it cannot see (org_id would be NULL -> NOT NULL violation).
CREATE FUNCTION wd.inherit_case_org() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.org_id := (SELECT c.org_id FROM support_case c WHERE c.id = NEW.case_id);
  IF NEW.org_id IS NULL THEN
    RAISE EXCEPTION 'case not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE case_message (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organization (id),
  case_id          uuid NOT NULL REFERENCES support_case (id),
  author_id        uuid REFERENCES app_user (id),
  author_is_staff  boolean NOT NULL,
  visibility       text NOT NULL CHECK (visibility IN ('public', 'internal')),
  body_html        text NOT NULL,
  source           text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'email', 'api', 'system')),
  email_message_id text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_message_case_idx ON case_message (case_id, created_at);
CREATE UNIQUE INDEX case_message_email_uq ON case_message (email_message_id) WHERE email_message_id IS NOT NULL;
CREATE TRIGGER case_message_org BEFORE INSERT ON case_message FOR EACH ROW EXECUTE FUNCTION wd.inherit_case_org();
ALTER TABLE case_message ENABLE ROW LEVEL SECURITY;
-- Internal notes are invisible to customers even if application code forgets to filter.
CREATE POLICY case_message_read ON case_message FOR SELECT
  USING (wd.can_see_org(org_id) AND (visibility = 'public' OR wd.is_internal()));
CREATE POLICY case_message_insert ON case_message FOR INSERT
  WITH CHECK (wd.can_see_org(org_id) AND (visibility = 'public' OR wd.is_internal()) AND (author_is_staff = false OR wd.is_internal()));

-- tus uploads awaiting binding to a case/message. Owned by the uploading user.
CREATE TABLE upload (
  id          text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
  org_id      uuid NOT NULL REFERENCES organization (id),
  user_id     uuid NOT NULL REFERENCES app_user (id),
  file_name   text NOT NULL,
  size_bytes  bigint NOT NULL CHECK (size_bytes >= 0),
  completed   boolean NOT NULL DEFAULT false,
  bound_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE upload ENABLE ROW LEVEL SECURITY;
CREATE POLICY upload_owner ON upload FOR ALL
  USING (wd.is_internal() OR user_id = wd.current_user_id())
  WITH CHECK (wd.is_internal() OR (user_id = wd.current_user_id() AND org_id = wd.current_org()));

CREATE TABLE case_attachment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organization (id),
  case_id         uuid NOT NULL REFERENCES support_case (id),
  message_id      uuid REFERENCES case_message (id),
  upload_id       text NOT NULL UNIQUE REFERENCES upload (id),
  file_name       text NOT NULL CHECK (file_name !~ '[/\\]' AND length(file_name) BETWEEN 1 AND 255),
  content_type    text,
  size_bytes      bigint NOT NULL CHECK (size_bytes BETWEEN 0 AND 2147483648),
  sha256          text,
  quarantine_key  text NOT NULL,
  object_key      text,
  original_key    text,
  scan_status     text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'infected', 'rejected', 'error')),
  scan_detail     text,
  secrets_masked  boolean NOT NULL DEFAULT false,
  masked_count    int NOT NULL DEFAULT 0,
  visibility      text NOT NULL CHECK (visibility IN ('public', 'internal')),
  uploaded_by     uuid NOT NULL REFERENCES app_user (id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_attachment_case_idx ON case_attachment (case_id);
CREATE INDEX case_attachment_pending_idx ON case_attachment (created_at) WHERE scan_status = 'pending';
CREATE TRIGGER case_attachment_org BEFORE INSERT ON case_attachment FOR EACH ROW EXECUTE FUNCTION wd.inherit_case_org();
ALTER TABLE case_attachment ENABLE ROW LEVEL SECURITY;
CREATE POLICY case_attachment_read ON case_attachment FOR SELECT
  USING (wd.can_see_org(org_id) AND (visibility = 'public' OR wd.is_internal()));
CREATE POLICY case_attachment_insert ON case_attachment FOR INSERT
  WITH CHECK (wd.can_see_org(org_id) AND (visibility = 'public' OR wd.is_internal()));
-- Only the scan worker (internal context) changes scan results.
CREATE POLICY case_attachment_update ON case_attachment FOR UPDATE USING (wd.is_internal()) WITH CHECK (wd.is_internal());

CREATE TABLE case_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organization (id),
  case_id     uuid NOT NULL REFERENCES support_case (id),
  type        text NOT NULL,
  visibility  text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal')),
  data        jsonb NOT NULL DEFAULT '{}',
  actor_id    uuid REFERENCES app_user (id),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_event_case_idx ON case_event (case_id, at);
CREATE TRIGGER case_event_org BEFORE INSERT ON case_event FOR EACH ROW EXECUTE FUNCTION wd.inherit_case_org();
ALTER TABLE case_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY case_event_read ON case_event FOR SELECT
  USING (wd.can_see_org(org_id) AND (visibility = 'public' OR wd.is_internal()));
CREATE POLICY case_event_insert ON case_event FOR INSERT WITH CHECK (wd.can_see_org(org_id));

CREATE TABLE sla_clock (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organization (id),
  case_id        uuid NOT NULL REFERENCES support_case (id),
  metric         text NOT NULL CHECK (metric IN ('first_response', 'update', 'restoration', 'resolution')),
  target_minutes int NOT NULL CHECK (target_minutes > 0),
  -- Snapshot of the calendar used (tz, weekly, holidays, 24x7) so later edits don't move running clocks.
  calendar       jsonb NOT NULL,
  started_at     timestamptz NOT NULL,
  due_at         timestamptz NOT NULL,
  paused_ms      bigint NOT NULL DEFAULT 0,
  paused_at      timestamptz,
  met_at         timestamptz,
  breached_at    timestamptz,
  last_warn_pct  smallint NOT NULL DEFAULT 0,
  UNIQUE (case_id, metric)
);
CREATE INDEX sla_clock_due_idx ON sla_clock (due_at) WHERE met_at IS NULL AND breached_at IS NULL AND paused_at IS NULL;
CREATE TRIGGER sla_clock_org BEFORE INSERT ON sla_clock FOR EACH ROW EXECUTE FUNCTION wd.inherit_case_org();
ALTER TABLE sla_clock ENABLE ROW LEVEL SECURITY;
CREATE POLICY sla_clock_rw ON sla_clock FOR ALL USING (wd.can_see_org(org_id)) WITH CHECK (wd.can_see_org(org_id));

CREATE TABLE csat_response (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organization (id),
  case_id    uuid NOT NULL UNIQUE REFERENCES support_case (id),
  user_id    uuid NOT NULL REFERENCES app_user (id),
  score      smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER csat_org BEFORE INSERT ON csat_response FOR EACH ROW EXECUTE FUNCTION wd.inherit_case_org();
ALTER TABLE csat_response ENABLE ROW LEVEL SECURITY;
CREATE POLICY csat_rw ON csat_response FOR ALL USING (wd.can_see_org(org_id)) WITH CHECK (wd.can_see_org(org_id));

CREATE TABLE notification (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid REFERENCES organization (id),
  user_id      uuid REFERENCES app_user (id),
  channel      text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'in_app')),
  recipient    text NOT NULL,
  template_key text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'suppressed')),
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);
CREATE INDEX notification_user_idx ON notification (user_id, created_at DESC);
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_read ON notification FOR SELECT USING (wd.is_internal() OR user_id = wd.current_user_id());
CREATE POLICY notification_write ON notification FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());

-- Inbound mail that could not be safely threaded (unknown sender, bad token). Staff review only.
CREATE TABLE inbound_email_hold (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  text,
  from_addr   text NOT NULL,
  subject     text,
  reason      text NOT NULL,
  raw_key     text,
  case_id     uuid REFERENCES support_case (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE inbound_email_hold ENABLE ROW LEVEL SECURITY;
CREATE POLICY inbound_hold_staff ON inbound_email_hold FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());

-- Display names for people shown on a case thread. Staff names are shown to customers (they are
-- talking to them); customer names only within the caller's visible organisations.
CREATE FUNCTION wd.display_names(p_ids uuid[]) RETURNS TABLE (id uuid, display_name text, is_staff boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, wd AS $$
  SELECT u.id, u.display_name, o.org_type = 'internal'
  FROM app_user u JOIN organization o ON o.id = u.org_id
  WHERE u.id = ANY (p_ids) AND (o.org_type = 'internal' OR wd.can_see_org(u.org_id))
$$;
REVOKE ALL ON FUNCTION wd.display_names FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wd.display_names TO wd_app;

GRANT SELECT ON queue TO wd_app;
GRANT USAGE ON SEQUENCE support_case_number_seq TO wd_app;
GRANT EXECUTE ON FUNCTION wd.next_case_number TO wd_app;
GRANT SELECT, INSERT, UPDATE ON support_case, upload, case_attachment, sla_clock, csat_response, notification, inbound_email_hold TO wd_app;
GRANT SELECT, INSERT ON case_message, case_event TO wd_app;   -- conversation history is append-only
