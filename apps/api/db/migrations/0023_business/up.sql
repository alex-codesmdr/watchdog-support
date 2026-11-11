-- 0023: contracts and invoices, the renewal pipeline, on-call roster, product lifecycle advice,
-- and the feature request board.

-- ---------------------------------------------------------------- contracts and invoices
-- A support contract groups the coverage (entitlements) that share its reference.
CREATE TABLE contract (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organization (id),
  ref             text NOT NULL CHECK (length(ref) BETWEEN 2 AND 60),
  title           text NOT NULL CHECK (length(title) BETWEEN 3 AND 140),
  value_inr       numeric(14, 2) NOT NULL CHECK (value_inr >= 0),
  starts_on       date NOT NULL,
  ends_on         date NOT NULL,
  owner_id        uuid REFERENCES app_user (id),
  -- Where the renewal stands, kept by the account owner.
  renewal_stage   text NOT NULL DEFAULT 'not_started'
                  CHECK (renewal_stage IN ('not_started', 'contacted', 'quoted', 'won', 'lost')),
  renewal_note    text CHECK (length(renewal_note) <= 2000),
  renewal_updated_at timestamptz,
  created_by      uuid NOT NULL REFERENCES app_user (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, ref),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX contract_ends_idx ON contract (ends_on);
CREATE TRIGGER contract_touch BEFORE UPDATE ON contract FOR EACH ROW EXECUTE FUNCTION wd.touch_updated_at();
ALTER TABLE contract ENABLE ROW LEVEL SECURITY;
-- Money stays with the customer itself: partners acting for a customer do not see contracts.
CREATE POLICY contract_read ON contract FOR SELECT USING (wd.is_internal() OR org_id = wd.current_org());
CREATE POLICY contract_write ON contract FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());
GRANT SELECT, INSERT, UPDATE ON contract TO wd_app;

CREATE TABLE invoice (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id  uuid NOT NULL REFERENCES contract (id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES organization (id),
  number       text NOT NULL UNIQUE CHECK (length(number) BETWEEN 2 AND 40),
  issued_on    date NOT NULL,
  due_on       date NOT NULL,
  amount_inr   numeric(14, 2) NOT NULL CHECK (amount_inr >= 0),
  status       text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'paid', 'cancelled')),
  paid_on      date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (due_on >= issued_on),
  CHECK ((status = 'paid') = (paid_on IS NOT NULL))
);
CREATE INDEX invoice_contract_idx ON invoice (contract_id, issued_on DESC);
ALTER TABLE invoice ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_read ON invoice FOR SELECT USING (wd.is_internal() OR org_id = wd.current_org());
CREATE POLICY invoice_write ON invoice FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());
GRANT SELECT, INSERT, UPDATE ON invoice TO wd_app;

-- A customer can ask to renew a whole contract, not only one device.
ALTER TABLE renewal_request ALTER COLUMN asset_id DROP NOT NULL;
ALTER TABLE renewal_request ADD COLUMN contract_id uuid REFERENCES contract (id);
ALTER TABLE renewal_request ADD CONSTRAINT renewal_request_target_check
  CHECK (asset_id IS NOT NULL OR contract_id IS NOT NULL);
CREATE UNIQUE INDEX renewal_request_open_contract_uq ON renewal_request (contract_id) WHERE status = 'requested';

-- Weekly renewal digest to each account owner: at most one per person per week.
CREATE TABLE renewal_digest (
  user_id  uuid NOT NULL REFERENCES app_user (id),
  week     date NOT NULL,
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week)
);
ALTER TABLE renewal_digest ENABLE ROW LEVEL SECURITY;
CREATE POLICY renewal_digest_staff ON renewal_digest FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());
GRANT SELECT, INSERT ON renewal_digest TO wd_app;

-- ---------------------------------------------------------------- on-call roster
CREATE TABLE oncall_shift (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user (id),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  -- p1: carries the P1 phone and is assigned P1 cases no rule picks up.
  p1          boolean NOT NULL DEFAULT false,
  note        text CHECK (length(note) <= 200),
  created_by  uuid NOT NULL REFERENCES app_user (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '7 days')
);
CREATE INDEX oncall_shift_time_idx ON oncall_shift (starts_at, ends_at);
ALTER TABLE oncall_shift ENABLE ROW LEVEL SECURITY;
CREATE POLICY oncall_shift_staff ON oncall_shift FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());
GRANT SELECT, INSERT, DELETE ON oncall_shift TO wd_app;

CREATE FUNCTION wd.on_shift(u uuid, p1_only boolean DEFAULT false) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, wd AS $$
  SELECT EXISTS (SELECT 1 FROM oncall_shift s
                  WHERE s.user_id = u AND now() >= s.starts_at AND now() < s.ends_at
                    AND (NOT p1_only OR s.p1))
$$;
REVOKE ALL ON FUNCTION wd.on_shift(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wd.on_shift(uuid, boolean) TO wd_app;

-- Routing now prefers engineers on shift; a P1 that no rule assigns goes to the P1 on-call engineer.
CREATE OR REPLACE FUNCTION wd.route_case(p_case uuid) RETURNS TABLE (routed_rule uuid, routed_to uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, wd AS $$
DECLARE
  c record;
  r routing_rule;
  pick uuid;
BEGIN
  SELECT sc.id, sc.org_id, sc.severity, sc.category, sc.assignee_id, p.family_id
    INTO c
    FROM support_case sc
    LEFT JOIN asset a ON a.id = sc.asset_id
    LEFT JOIN product p ON p.id = a.product_id
   WHERE sc.id = p_case;
  IF NOT FOUND OR c.assignee_id IS NOT NULL OR NOT wd.can_see_org(c.org_id) THEN
    RETURN;
  END IF;

  SELECT * INTO r FROM routing_rule rr
   WHERE rr.enabled
     AND (rr.severities IS NULL OR cardinality(rr.severities) = 0 OR c.severity = ANY (rr.severities))
     AND (rr.categories IS NULL OR cardinality(rr.categories) = 0 OR c.category = ANY (rr.categories))
     AND (rr.family_ids IS NULL OR cardinality(rr.family_ids) = 0 OR c.family_id = ANY (rr.family_ids))
     AND (rr.org_ids    IS NULL OR cardinality(rr.org_ids)    = 0 OR c.org_id    = ANY (rr.org_ids))
   ORDER BY rr.position, rr.created_at
   LIMIT 1;

  IF NOT FOUND THEN
    IF c.severity <> 'P1' THEN RETURN; END IF;
    -- No rule: a P1 goes to whoever carries the P1 phone now (least busy if several).
    SELECT u.id INTO pick
      FROM app_user u
     WHERE u.status = 'active' AND wd.on_shift(u.id, true)
     ORDER BY (SELECT count(*) FROM support_case o
                WHERE o.assignee_id = u.id AND o.status NOT IN ('resolved', 'closed')), u.id
     LIMIT 1;
    IF pick IS NULL THEN RETURN; END IF;
    UPDATE support_case sc SET assignee_id = pick, version = sc.version + 1 WHERE sc.id = c.id;
    INSERT INTO case_event (org_id, case_id, type, visibility, actor_id, data)
    VALUES (c.org_id, c.id, 'assigned', 'internal', NULL,
            jsonb_build_object('assigneeId', pick, 'auto', true, 'onCall', true));
    RETURN QUERY SELECT NULL::uuid, pick;
    RETURN;
  END IF;

  -- Among the rule's engineers: those on shift now first, then the least busy, then whoever was
  -- assigned longest ago.
  SELECT u.id INTO pick
    FROM app_user u
    JOIN user_role ur ON ur.user_id = u.id
     AND ur.role_key IN ('l1_engineer', 'l2_engineer', 'l3_engineer', 'support_manager')
   WHERE u.id = ANY (r.assignee_ids) AND u.status = 'active'
   GROUP BY u.id
   ORDER BY wd.on_shift(u.id) DESC,
            (SELECT count(*) FROM support_case o
              WHERE o.assignee_id = u.id AND o.status NOT IN ('resolved', 'closed')),
            (SELECT max(e.at) FROM case_event e
              WHERE e.type = 'assigned' AND e.data->>'assigneeId' = u.id::text) NULLS FIRST,
            u.id
   LIMIT 1;

  UPDATE support_case sc
     SET queue_id = COALESCE(r.queue_id, sc.queue_id),
         assignee_id = COALESCE(pick, sc.assignee_id),
         version = sc.version + 1
   WHERE sc.id = c.id;
  INSERT INTO case_event (org_id, case_id, type, visibility, actor_id, data)
  VALUES (c.org_id, c.id, 'routed', 'internal', NULL,
          jsonb_build_object('ruleId', r.id, 'rule', r.name, 'assigneeId', pick, 'queueId', r.queue_id));
  IF pick IS NOT NULL THEN
    INSERT INTO case_event (org_id, case_id, type, visibility, actor_id, data)
    VALUES (c.org_id, c.id, 'assigned', 'internal', NULL, jsonb_build_object('assigneeId', pick, 'auto', true));
  END IF;
  RETURN QUERY SELECT r.id, pick;
END $$;

-- ---------------------------------------------------------------- product lifecycle advice
ALTER TABLE product
  ADD COLUMN replacement_product_id uuid REFERENCES product (id),
  ADD COLUMN lifecycle_note text CHECK (length(lifecycle_note) <= 1000),
  ADD CONSTRAINT product_replacement_not_self CHECK (replacement_product_id IS NULL OR replacement_product_id <> id);
GRANT SELECT (replacement_product_id, lifecycle_note) ON product TO wd_app;
GRANT UPDATE (lifecycle, eos_date, eol_date, replacement_product_id, lifecycle_note) ON product TO wd_app;

-- ---------------------------------------------------------------- feature request board
CREATE TABLE idea (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organization (id),
  author_id       uuid NOT NULL REFERENCES app_user (id),
  family_id       uuid REFERENCES product_family (id),
  title           text NOT NULL CHECK (length(title) BETWEEN 8 AND 140),
  body            text NOT NULL CHECK (length(body) BETWEEN 10 AND 4000),
  status          text NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'under_review', 'planned', 'in_progress', 'done', 'declined')),
  response        text CHECK (length(response) <= 2000),
  hidden          boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idea_status_idx ON idea (status, created_at DESC);
CREATE TRIGGER idea_touch BEFORE UPDATE ON idea FOR EACH ROW EXECUTE FUNCTION wd.touch_updated_at();
ALTER TABLE idea ENABLE ROW LEVEL SECURITY;
-- Every signed-in person reads the board (the API never shows who posted to other customers);
-- people post as themselves; only staff change status, respond or hide.
CREATE POLICY idea_read ON idea FOR SELECT
  USING (wd.is_internal() OR (wd.current_user_id() IS NOT NULL AND (NOT hidden OR author_id = wd.current_user_id())));
CREATE POLICY idea_insert ON idea FOR INSERT
  WITH CHECK (author_id = wd.current_user_id() AND org_id = wd.current_org());
CREATE POLICY idea_staff ON idea FOR UPDATE USING (wd.is_internal()) WITH CHECK (wd.is_internal());
GRANT SELECT, INSERT, UPDATE ON idea TO wd_app;

CREATE TABLE idea_vote (
  idea_id   uuid NOT NULL REFERENCES idea (id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES app_user (id),
  at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, user_id)
);
ALTER TABLE idea_vote ENABLE ROW LEVEL SECURITY;
CREATE POLICY idea_vote_read ON idea_vote FOR SELECT USING (wd.current_user_id() IS NOT NULL);
CREATE POLICY idea_vote_own ON idea_vote FOR INSERT WITH CHECK (user_id = wd.current_user_id());
CREATE POLICY idea_vote_del ON idea_vote FOR DELETE USING (user_id = wd.current_user_id());
GRANT SELECT, INSERT, DELETE ON idea_vote TO wd_app;
