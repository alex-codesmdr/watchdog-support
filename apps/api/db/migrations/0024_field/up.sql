-- 0024: engineer visits booked from a case, spare-parts stock at depots, and community answers.

-- ---------------------------------------------------------------- visits
CREATE TABLE visit (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES support_case (id),
  org_id         uuid NOT NULL REFERENCES organization (id),
  kind           text NOT NULL CHECK (kind IN ('onsite', 'remote')),
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  engineer_id    uuid REFERENCES app_user (id),
  site_id        uuid REFERENCES site (id),
  contact_name   text NOT NULL CHECK (length(contact_name) BETWEEN 2 AND 120),
  contact_phone  text NOT NULL CHECK (contact_phone ~ '^\+?[0-9 -]{8,20}$'),
  notes          text CHECK (length(notes) <= 1000),
  status         text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'done', 'cancelled')),
  cancel_reason  text CHECK (length(cancel_reason) <= 500),
  booked_by      uuid NOT NULL REFERENCES app_user (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX visit_time_idx ON visit (starts_at) WHERE status = 'booked';
CREATE INDEX visit_case_idx ON visit (case_id);
-- One engineer is never booked twice at the same time.
ALTER TABLE visit ADD CONSTRAINT visit_no_double_booking
  EXCLUDE USING gist (engineer_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status = 'booked');
ALTER TABLE visit ENABLE ROW LEVEL SECURITY;
CREATE POLICY visit_read ON visit FOR SELECT USING (wd.can_see_org(org_id));
CREATE POLICY visit_write ON visit FOR ALL USING (wd.can_see_org(org_id)) WITH CHECK (wd.can_see_org(org_id));
GRANT SELECT, INSERT, UPDATE ON visit TO wd_app;

-- Booking runs as the customer, who cannot see the roster or other customers' visits; this
-- returns only the engineers free for a whole window, never who they are busy with.
CREATE FUNCTION wd.free_engineers(p_start timestamptz, p_end timestamptz)
  RETURNS TABLE (engineer_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, wd AS $$
  SELECT DISTINCT s.user_id
    FROM oncall_shift s
    JOIN app_user u ON u.id = s.user_id AND u.status = 'active'
   WHERE s.starts_at <= p_start AND s.ends_at >= p_end
     AND NOT EXISTS (SELECT 1 FROM visit v
                      WHERE v.engineer_id = s.user_id AND v.status = 'booked'
                        AND tstzrange(v.starts_at, v.ends_at) && tstzrange(p_start, p_end))
$$;
REVOKE ALL ON FUNCTION wd.free_engineers(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wd.free_engineers(timestamptz, timestamptz) TO wd_app;

-- ---------------------------------------------------------------- spare-parts stock
-- Spares are WatchDog-owned devices (internal organisation) kept at a depot until shipped.
CREATE TABLE depot (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name     text NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 80),
  city     text NOT NULL,
  state    text NOT NULL,
  active   boolean NOT NULL DEFAULT true
);
ALTER TABLE depot ENABLE ROW LEVEL SECURITY;
CREATE POLICY depot_staff ON depot FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());
GRANT SELECT, INSERT, UPDATE ON depot TO wd_app;

ALTER TABLE asset ADD COLUMN depot_id uuid REFERENCES depot (id);
CREATE INDEX asset_depot_idx ON asset (depot_id, product_id) WHERE depot_id IS NOT NULL;

CREATE TABLE spare_level (
  depot_id    uuid NOT NULL REFERENCES depot (id),
  product_id  uuid NOT NULL REFERENCES product (id),
  min_on_hand integer NOT NULL CHECK (min_on_hand BETWEEN 0 AND 1000),
  PRIMARY KEY (depot_id, product_id)
);
ALTER TABLE spare_level ENABLE ROW LEVEL SECURITY;
CREATE POLICY spare_level_staff ON spare_level FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());
GRANT SELECT, INSERT, UPDATE, DELETE ON spare_level TO wd_app;

-- ---------------------------------------------------------------- community answers
CREATE TABLE forum_question (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organization (id),
  author_id          uuid NOT NULL REFERENCES app_user (id),
  family_id          uuid REFERENCES product_family (id),
  title              text NOT NULL CHECK (length(title) BETWEEN 10 AND 160),
  body               text NOT NULL CHECK (length(body) BETWEEN 10 AND 8000),
  accepted_answer_id uuid,
  hidden             boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  search_vec         tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED
);
CREATE INDEX forum_question_search_idx ON forum_question USING gin (search_vec);
CREATE INDEX forum_question_recent_idx ON forum_question (created_at DESC);
CREATE TABLE forum_answer (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  uuid NOT NULL REFERENCES forum_question (id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES organization (id),
  author_id    uuid NOT NULL REFERENCES app_user (id),
  body         text NOT NULL CHECK (length(body) BETWEEN 2 AND 8000),
  by_staff     boolean NOT NULL DEFAULT false,
  hidden       boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forum_answer_question_idx ON forum_answer (question_id, created_at);
ALTER TABLE forum_question ADD CONSTRAINT forum_question_accepted_fk
  FOREIGN KEY (accepted_answer_id) REFERENCES forum_answer (id) ON DELETE SET NULL;

ALTER TABLE forum_question ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_answer ENABLE ROW LEVEL SECURITY;
-- Everyone signed in reads the community; people post as themselves; only staff hide posts.
-- The asker may mark the accepted answer (checked in the API; the column is the only change).
CREATE POLICY forum_q_read ON forum_question FOR SELECT
  USING (wd.is_internal() OR (wd.current_user_id() IS NOT NULL AND (NOT hidden OR author_id = wd.current_user_id())));
CREATE POLICY forum_q_insert ON forum_question FOR INSERT
  WITH CHECK (author_id = wd.current_user_id() AND org_id = wd.current_org());
CREATE POLICY forum_q_update ON forum_question FOR UPDATE
  USING (wd.is_internal() OR author_id = wd.current_user_id())
  WITH CHECK (wd.is_internal() OR author_id = wd.current_user_id());
CREATE POLICY forum_a_read ON forum_answer FOR SELECT
  USING (wd.is_internal() OR (wd.current_user_id() IS NOT NULL AND (NOT hidden OR author_id = wd.current_user_id())));
CREATE POLICY forum_a_insert ON forum_answer FOR INSERT
  WITH CHECK (author_id = wd.current_user_id() AND org_id = wd.current_org());
CREATE POLICY forum_a_update ON forum_answer FOR UPDATE USING (wd.is_internal()) WITH CHECK (wd.is_internal());
GRANT SELECT, INSERT ON forum_question, forum_answer TO wd_app;
GRANT UPDATE (accepted_answer_id, hidden) ON forum_question TO wd_app;
GRANT UPDATE (hidden) ON forum_answer TO wd_app;

-- Display names for the community: first name and initial, never the organisation.
CREATE FUNCTION wd.public_name(u uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, wd AS $$
  SELECT CASE WHEN array_length(regexp_split_to_array(trim(display_name), '\s+'), 1) > 1
              THEN split_part(trim(display_name), ' ', 1) || ' ' ||
                   left((regexp_split_to_array(trim(display_name), '\s+'))[array_length(regexp_split_to_array(trim(display_name), '\s+'), 1)], 1) || '.'
              ELSE trim(display_name) END
    FROM app_user WHERE id = u
$$;
REVOKE ALL ON FUNCTION wd.public_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wd.public_name(uuid) TO wd_app;
