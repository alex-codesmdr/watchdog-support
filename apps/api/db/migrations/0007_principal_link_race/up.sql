-- 0007: make first-login account linking safe under concurrent requests.
-- A browser's first page load sends several API calls at once. Without serialisation the calls
-- race to link the identity to the portal account; losers saw "not provisioned" (403).
-- An advisory lock per identity serialises linking, and each statement re-reads after the wait.
CREATE OR REPLACE FUNCTION wd.resolve_principal(p_subject text, p_email text, p_email_verified boolean)
RETURNS TABLE (user_id uuid, org_id uuid, org_type text, org_status text, user_status text, roles text[], delegated uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, wd AS $$
DECLARE v_user app_user%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM app_user u WHERE u.kc_subject = p_subject;
  IF NOT FOUND AND p_email_verified THEN
    PERFORM pg_advisory_xact_lock(726200201, hashtext(p_subject));
    SELECT * INTO v_user FROM app_user u WHERE u.kc_subject = p_subject;
    IF NOT FOUND THEN
      UPDATE app_user u SET kc_subject = p_subject, status = CASE WHEN u.status = 'invited' THEN 'active' ELSE u.status END
        WHERE u.email = p_email AND u.kc_subject IS NULL RETURNING * INTO v_user;
    END IF;
  END IF;
  IF v_user.id IS NULL THEN RETURN; END IF;
  UPDATE app_user u SET last_login_at = now() WHERE u.id = v_user.id AND (u.last_login_at IS NULL OR u.last_login_at < now() - interval '5 minutes');
  RETURN QUERY
    SELECT v_user.id, o.id, o.org_type, o.status, v_user.status,
      coalesce((SELECT array_agg(ur.role_key ORDER BY ur.role_key) FROM user_role ur WHERE ur.user_id = v_user.id), '{}'),
      coalesce((SELECT array_agg(d.customer_org_id) FROM partner_delegation d
                 WHERE d.partner_org_id = o.id AND d.revoked_at IS NULL AND (d.expires_at IS NULL OR d.expires_at > now())), '{}')
    FROM organization o WHERE o.id = v_user.org_id;
END $$;
