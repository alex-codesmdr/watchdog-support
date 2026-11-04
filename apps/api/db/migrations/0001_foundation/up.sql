-- 0001 foundation: extensions, tenancy helpers, organisations, users, roles, registration,
-- delegation, consent, hash-chained audit log, transactional outbox.
--
-- Tenancy model (ADR-004): every tenant table carries org_id and has RLS ENABLED. The API connects
-- as wd_app (non-owner, NOBYPASSRLS) and sets transaction-local GUCs:
--   app.user_id, app.org_id, app.delegated_orgs (comma list), app.is_internal
-- Unset GUCs resolve to NULL / false / empty, so a forgotten context returns zero rows (fail closed).
-- The API asserts at boot that its role neither owns tables nor bypasses RLS.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA wd;
GRANT USAGE ON SCHEMA wd TO wd_app;

CREATE FUNCTION wd.current_org() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
CREATE FUNCTION wd.current_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION wd.is_internal() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('app.is_internal', true), '')::boolean, false) $$;
CREATE FUNCTION wd.delegated_orgs() RETURNS uuid[] LANGUAGE sql STABLE AS
$$ SELECT coalesce(string_to_array(nullif(current_setting('app.delegated_orgs', true), ''), ',')::uuid[], '{}'::uuid[]) $$;
CREATE FUNCTION wd.can_see_org(o uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT wd.is_internal() OR o = wd.current_org() OR o = ANY (wd.delegated_orgs()) $$;

CREATE FUNCTION wd.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ---------------------------------------------------------------- organisations
CREATE TABLE organization (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  org_type     text NOT NULL CHECK (org_type IN ('customer', 'partner', 'internal')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'rejected')),
  gstin        text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  data_region  text NOT NULL DEFAULT 'IN',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER organization_touch BEFORE UPDATE ON organization FOR EACH ROW EXECUTE FUNCTION wd.touch_updated_at();
ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_read ON organization FOR SELECT USING (wd.can_see_org(id));
CREATE POLICY organization_write ON organization FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());

CREATE TABLE org_domain (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  domain       citext NOT NULL CHECK (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  verify_token text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX org_domain_verified_uq ON org_domain (domain) WHERE verified_at IS NOT NULL;
CREATE INDEX org_domain_org_idx ON org_domain (org_id);
ALTER TABLE org_domain ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_domain_rw ON org_domain FOR ALL USING (wd.can_see_org(org_id)) WITH CHECK (wd.is_internal() OR org_id = wd.current_org());

-- ---------------------------------------------------------------- users & roles
CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organization (id),
  kc_subject    text UNIQUE,
  email         citext NOT NULL UNIQUE,
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  phone         text,
  locale        text NOT NULL DEFAULT 'en-IN',
  timezone      text NOT NULL DEFAULT 'Asia/Kolkata',
  status        text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  is_service    boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_user_org_idx ON app_user (org_id, status);
CREATE TRIGGER app_user_touch BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION wd.touch_updated_at();
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_user_read ON app_user FOR SELECT USING (wd.can_see_org(org_id));
CREATE POLICY app_user_write ON app_user FOR INSERT WITH CHECK (wd.is_internal() OR org_id = wd.current_org());
CREATE POLICY app_user_update ON app_user FOR UPDATE USING (wd.is_internal() OR org_id = wd.current_org())
  WITH CHECK (wd.is_internal() OR org_id = wd.current_org());

CREATE TABLE role (
  key         text PRIMARY KEY,
  name        text NOT NULL,
  is_internal boolean NOT NULL
);
CREATE TABLE permission (key text PRIMARY KEY);
CREATE TABLE role_permission (
  role_key       text NOT NULL REFERENCES role (key) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permission (key) ON DELETE CASCADE,
  PRIMARY KEY (role_key, permission_key)
);
CREATE TABLE user_role (
  user_id    uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  role_key   text NOT NULL REFERENCES role (key),
  granted_by uuid REFERENCES app_user (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_key)
);
ALTER TABLE user_role ENABLE ROW LEVEL SECURITY;
-- Visible / grantable only where the user row itself is visible (RLS on app_user applies inside).
CREATE POLICY user_role_read ON user_role FOR SELECT USING (EXISTS (SELECT 1 FROM app_user u WHERE u.id = user_id));
CREATE POLICY user_role_write ON user_role FOR ALL
  USING (wd.is_internal() OR EXISTS (SELECT 1 FROM app_user u WHERE u.id = user_id AND u.org_id = wd.current_org()))
  WITH CHECK (wd.is_internal() OR EXISTS (SELECT 1 FROM app_user u WHERE u.id = user_id AND u.org_id = wd.current_org()));

-- Internal roles only for users of an internal org; external roles never for internal staff;
-- and nobody grants roles to themselves (segregation of duties).
CREATE FUNCTION wd.check_role_grant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, wd AS $$
DECLARE r_internal boolean; o_type text;
BEGIN
  SELECT is_internal INTO r_internal FROM role WHERE key = NEW.role_key;
  SELECT o.org_type INTO o_type FROM app_user u JOIN organization o ON o.id = u.org_id WHERE u.id = NEW.user_id;
  IF r_internal AND o_type <> 'internal' THEN
    RAISE EXCEPTION 'internal role % cannot be granted to an external user', NEW.role_key USING ERRCODE = '42501';
  END IF;
  IF NOT r_internal AND o_type = 'internal' THEN
    RAISE EXCEPTION 'external role % cannot be granted to internal staff', NEW.role_key USING ERRCODE = '42501';
  END IF;
  IF NEW.granted_by IS NOT NULL AND NEW.granted_by = NEW.user_id THEN
    RAISE EXCEPTION 'users cannot grant roles to themselves' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_role_check BEFORE INSERT OR UPDATE ON user_role FOR EACH ROW EXECUTE FUNCTION wd.check_role_grant();

-- ---------------------------------------------------------------- partner delegation
CREATE TABLE partner_delegation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_org_id  uuid NOT NULL REFERENCES organization (id),
  customer_org_id uuid NOT NULL REFERENCES organization (id),
  scope           text[] NOT NULL DEFAULT '{cases,assets}',
  granted_by      uuid REFERENCES app_user (id),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (partner_org_id <> customer_org_id)
);
CREATE UNIQUE INDEX partner_delegation_active_uq ON partner_delegation (partner_org_id, customer_org_id) WHERE revoked_at IS NULL;
ALTER TABLE partner_delegation ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_delegation_read ON partner_delegation FOR SELECT
  USING (wd.is_internal() OR partner_org_id = wd.current_org() OR customer_org_id = wd.current_org());
-- Only the customer (or staff) grants and revokes.
CREATE POLICY partner_delegation_write ON partner_delegation FOR ALL
  USING (wd.is_internal() OR customer_org_id = wd.current_org())
  WITH CHECK (wd.is_internal() OR customer_org_id = wd.current_org());

-- ---------------------------------------------------------------- registration & consent
CREATE TABLE registration (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL UNIQUE REFERENCES organization (id),
  admin_name    text NOT NULL,
  admin_email   citext NOT NULL,
  phone         text,
  email_domain  citext NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by    uuid REFERENCES app_user (id),
  decided_at    timestamptz,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX registration_status_idx ON registration (status, created_at);
ALTER TABLE registration ENABLE ROW LEVEL SECURITY;
CREATE POLICY registration_staff ON registration FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());

CREATE TABLE consent_record (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid REFERENCES organization (id),
  user_id        uuid REFERENCES app_user (id),
  email          citext NOT NULL,
  purpose        text NOT NULL,
  notice_version text NOT NULL,
  given_at       timestamptz NOT NULL DEFAULT now(),
  withdrawn_at   timestamptz,
  ip             inet
);
ALTER TABLE consent_record ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_read ON consent_record FOR SELECT USING (wd.is_internal() OR user_id = wd.current_user_id());

-- Public self-registration is the only unauthenticated write. It goes through this narrow
-- SECURITY DEFINER function instead of opening RLS on organization/app_user.
CREATE FUNCTION wd.register_organization(
  p_org_name text, p_gstin text, p_admin_name text, p_admin_email text, p_phone text,
  p_notice_version text, p_ip inet
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, wd AS $$
DECLARE v_org uuid; v_reg uuid; v_domain text;
BEGIN
  IF EXISTS (SELECT 1 FROM app_user WHERE email = p_admin_email) THEN
    -- Do not reveal account existence: behave as success, create nothing.
    RETURN NULL;
  END IF;
  v_domain := lower(split_part(p_admin_email, '@', 2));
  INSERT INTO organization (name, org_type, status, gstin) VALUES (p_org_name, 'customer', 'pending', p_gstin) RETURNING id INTO v_org;
  INSERT INTO app_user (org_id, email, display_name, phone, status) VALUES (v_org, p_admin_email, p_admin_name, p_phone, 'invited');
  INSERT INTO org_domain (org_id, domain) VALUES (v_org, v_domain);
  INSERT INTO registration (org_id, admin_name, admin_email, phone, email_domain)
    VALUES (v_org, p_admin_name, p_admin_email, p_phone, v_domain) RETURNING id INTO v_reg;
  INSERT INTO consent_record (org_id, email, purpose, notice_version, ip)
    VALUES (v_org, p_admin_email, 'account_and_support_services', p_notice_version, p_ip);
  RETURN v_reg;
END $$;
REVOKE ALL ON FUNCTION wd.register_organization FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wd.register_organization TO wd_app;

-- Resolves the principal for a verified token BEFORE tenant context exists.
-- Links a first login (kc_subject still NULL) by verified email.
CREATE FUNCTION wd.resolve_principal(p_subject text, p_email text, p_email_verified boolean)
RETURNS TABLE (user_id uuid, org_id uuid, org_type text, org_status text, user_status text, roles text[], delegated uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, wd AS $$
DECLARE v_user app_user%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM app_user u WHERE u.kc_subject = p_subject;
  IF NOT FOUND AND p_email_verified THEN
    UPDATE app_user u SET kc_subject = p_subject, status = CASE WHEN u.status = 'invited' THEN 'active' ELSE u.status END
      WHERE u.email = p_email AND u.kc_subject IS NULL RETURNING * INTO v_user;
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
REVOKE ALL ON FUNCTION wd.resolve_principal FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wd.resolve_principal TO wd_app;

-- ---------------------------------------------------------------- audit log (append-only, hash-chained)
CREATE SEQUENCE audit_log_seq;
CREATE TABLE audit_log (
  seq         bigint NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  org_id      uuid,
  actor_id    uuid,
  action      text NOT NULL,
  target_type text,
  target_id   uuid,
  diff        jsonb NOT NULL DEFAULT '{}',
  ip          inet,
  request_id  text,
  prev_hash   bytea,
  hash        bytea NOT NULL,
  PRIMARY KEY (seq, at)
) PARTITION BY RANGE (at);
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;
CREATE INDEX audit_log_seq_idx ON audit_log (seq DESC);
CREATE INDEX audit_log_org_idx ON audit_log (org_id, at DESC);
CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id);

CREATE FUNCTION wd.audit_hash(prev bytea, r audit_log) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
  SELECT digest(
    coalesce(encode(prev, 'hex'), '') || '|' || r.seq || '|' ||
    to_char(r.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    coalesce(r.org_id::text, '') || '|' || coalesce(r.actor_id::text, '') || '|' || r.action || '|' ||
    coalesce(r.target_type, '') || '|' || coalesce(r.target_id::text, '') || '|' || r.diff::text,
    'sha256')
$$;

-- Sequence number is taken AFTER the chain lock so that seq order == chain order.
CREATE FUNCTION wd.audit_chain() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, wd AS $$
DECLARE last bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(726200101);
  NEW.seq := nextval('audit_log_seq');
  SELECT a.hash INTO last FROM audit_log a ORDER BY a.seq DESC LIMIT 1;
  NEW.prev_hash := last;
  NEW.hash := wd.audit_hash(last, NEW);
  RETURN NEW;
END $$;
CREATE TRIGGER audit_log_chain BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION wd.audit_chain();

-- Returns the first seq whose hash does not verify, or NULL when the chain is intact.
CREATE FUNCTION wd.audit_verify() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, wd AS $$
DECLARE r audit_log; prev bytea := NULL;
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY seq LOOP
    IF r.prev_hash IS DISTINCT FROM prev OR r.hash <> wd.audit_hash(prev, r) THEN RETURN r.seq; END IF;
    prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION wd.audit_verify FROM PUBLIC;

-- Monthly partitions are created ahead of time by the maintenance job.
CREATE FUNCTION wd.ensure_audit_partition(p_month date) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s date := date_trunc('month', p_month); e date := (date_trunc('month', p_month) + interval '1 month')::date;
  n text := format('audit_log_%s', to_char(s, 'YYYYMM'));
BEGIN
  IF to_regclass(n) IS NULL THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)', n, s, e);
    EXECUTE format('REVOKE ALL ON %I FROM wd_app', n);
  END IF;
END $$;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_insert ON audit_log FOR INSERT WITH CHECK (org_id IS NULL OR wd.can_see_org(org_id));
CREATE POLICY audit_read ON audit_log FOR SELECT USING (wd.is_internal() OR org_id = wd.current_org());

-- ---------------------------------------------------------------- transactional outbox
CREATE TABLE outbox_event (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic        text NOT NULL,
  org_id       uuid,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts     int NOT NULL DEFAULT 0,
  last_error   text
);
CREATE INDEX outbox_pending_idx ON outbox_event (available_at) WHERE published_at IS NULL;
ALTER TABLE outbox_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbox_insert ON outbox_event FOR INSERT WITH CHECK (org_id IS NULL OR wd.can_see_org(org_id));
CREATE POLICY outbox_worker ON outbox_event FOR SELECT USING (wd.is_internal());
CREATE POLICY outbox_worker_upd ON outbox_event FOR UPDATE USING (wd.is_internal()) WITH CHECK (wd.is_internal());

-- ---------------------------------------------------------------- grants
GRANT SELECT, INSERT, UPDATE ON organization, org_domain, app_user, partner_delegation, registration TO wd_app;
GRANT SELECT, INSERT, DELETE ON user_role TO wd_app;
GRANT SELECT ON role, permission, role_permission TO wd_app;
GRANT SELECT, INSERT ON consent_record TO wd_app;
GRANT SELECT, INSERT ON audit_log TO wd_app;           -- never UPDATE / DELETE
REVOKE ALL ON audit_log_default FROM wd_app;
GRANT SELECT, INSERT, UPDATE ON outbox_event TO wd_app;
GRANT EXECUTE ON FUNCTION wd.current_org, wd.current_user_id, wd.is_internal, wd.delegated_orgs, wd.can_see_org TO wd_app;
