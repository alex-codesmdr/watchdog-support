-- 0016: automatic case routing. Rules are checked in order; the first enabled rule whose
-- conditions all match sets the queue and assigns the least busy of its engineers.

CREATE TABLE routing_rule (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (length(name) BETWEEN 3 AND 120),
  position      integer NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  -- Conditions: NULL or empty means "any".
  severities    text[] CHECK (severities <@ ARRAY['P1','P2','P3','P4']),
  categories    text[],
  family_ids    uuid[],
  org_ids       uuid[],
  -- Actions
  queue_id      uuid REFERENCES queue (id),
  assignee_ids  uuid[] NOT NULL DEFAULT '{}',
  created_by    uuid NOT NULL REFERENCES app_user (id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER routing_rule_touch BEFORE UPDATE ON routing_rule FOR EACH ROW EXECUTE FUNCTION wd.touch_updated_at();
CREATE INDEX routing_rule_position_idx ON routing_rule (position);
ALTER TABLE routing_rule ENABLE ROW LEVEL SECURITY;
CREATE POLICY routing_rule_staff ON routing_rule FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());
GRANT SELECT, INSERT, UPDATE, DELETE ON routing_rule TO wd_app;

-- Runs inside case creation as the customer, who cannot see rules, staff or other customers'
-- cases; so it is SECURITY DEFINER and only acts on a case the caller can see that is unassigned.
CREATE FUNCTION wd.route_case(p_case uuid) RETURNS TABLE (routed_rule uuid, routed_to uuid)
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
  IF NOT FOUND THEN RETURN; END IF;

  -- Least busy active engineer among the rule's list (open cases), ties by fewest recent assignments.
  SELECT u.id INTO pick
    FROM app_user u
    JOIN user_role ur ON ur.user_id = u.id
     AND ur.role_key IN ('l1_engineer', 'l2_engineer', 'l3_engineer', 'support_manager')
   WHERE u.id = ANY (r.assignee_ids) AND u.status = 'active'
   GROUP BY u.id
   ORDER BY (SELECT count(*) FROM support_case o
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
REVOKE ALL ON FUNCTION wd.route_case(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wd.route_case(uuid) TO wd_app;
