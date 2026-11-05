-- 0015: customer administrators manage their own team.
-- Emails are unique portal-wide, but RLS hides other organisations' users; this answers only
-- "is it taken" (no organisation, no name) so an invite can be refused with a clear message.
CREATE FUNCTION wd.email_taken(p_email text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, wd AS $$
  SELECT EXISTS (SELECT 1 FROM app_user WHERE email = lower(p_email))
      OR EXISTS (SELECT 1 FROM registration WHERE admin_email = lower(p_email) AND status = 'pending');
$$;
REVOKE ALL ON FUNCTION wd.email_taken(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wd.email_taken(text) TO wd_app;
