DROP TABLE IF EXISTS idea_vote;
DROP TABLE IF EXISTS idea;
ALTER TABLE product DROP CONSTRAINT IF EXISTS product_replacement_not_self,
  DROP COLUMN IF EXISTS lifecycle_note, DROP COLUMN IF EXISTS replacement_product_id;
-- Routing as it was before shifts (0016), then the shift helper can go.
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
DROP FUNCTION IF EXISTS wd.on_shift(uuid, boolean);
DROP TABLE IF EXISTS oncall_shift;
DROP TABLE IF EXISTS renewal_digest;
DROP INDEX IF EXISTS renewal_request_open_contract_uq;
ALTER TABLE renewal_request DROP CONSTRAINT IF EXISTS renewal_request_target_check;
DELETE FROM renewal_request WHERE asset_id IS NULL;
ALTER TABLE renewal_request DROP COLUMN IF EXISTS contract_id;
ALTER TABLE renewal_request ALTER COLUMN asset_id SET NOT NULL;
DROP TABLE IF EXISTS invoice;
DROP TABLE IF EXISTS contract;
