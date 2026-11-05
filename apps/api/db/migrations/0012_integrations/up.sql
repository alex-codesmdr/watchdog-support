-- 0012 integrations: organisation API keys and signed webhooks.

CREATE TABLE api_key (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organization (id),
  name         text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  -- Public part of the key (wdk_<prefix>_<secret>); the secret is stored only as a scrypt hash.
  prefix       text NOT NULL UNIQUE CHECK (prefix ~ '^[a-z0-9]{10}$'),
  secret_hash  text NOT NULL,
  scopes       text[] NOT NULL CHECK (scopes <@ ARRAY['cases:read', 'cases:write', 'assets:read', 'rmas:read']::text[] AND cardinality(scopes) > 0),
  created_by   uuid NOT NULL REFERENCES app_user (id),
  expires_at   timestamptz,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_key_org_idx ON api_key (org_id, created_at DESC);
ALTER TABLE api_key ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_key_org ON api_key FOR ALL
  USING (wd.is_internal() OR org_id = wd.current_org())
  WITH CHECK (wd.is_internal() OR org_id = wd.current_org());

-- Key lookup before any tenant context exists (like resolve_principal). Returns the hash for
-- verification in the API; the key's acting user must still be active with roles in the org.
CREATE FUNCTION wd.resolve_api_key(p_prefix text)
RETURNS TABLE (key_id uuid, secret_hash text, scopes text[], expires_at timestamptz, revoked_at timestamptz,
               user_id uuid, user_status text, kc_subject text, email text, org_id uuid, org_type text, org_status text,
               roles text[], delegated uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, wd AS $$
  SELECT k.id, k.secret_hash, k.scopes, k.expires_at, k.revoked_at,
         u.id, u.status, u.kc_subject, u.email, o.id, o.org_type, o.status,
         coalesce((SELECT array_agg(ur.role_key) FROM user_role ur WHERE ur.user_id = u.id), '{}'),
         coalesce((SELECT array_agg(d.customer_org_id) FROM partner_delegation d
                    WHERE d.partner_org_id = o.id AND d.revoked_at IS NULL
                      AND (d.expires_at IS NULL OR d.expires_at > now())), '{}')
    FROM api_key k
    JOIN app_user u ON u.id = k.created_by
    JOIN organization o ON o.id = k.org_id
   WHERE k.prefix = p_prefix AND u.org_id = k.org_id
$$;
CREATE FUNCTION wd.touch_api_key(p_key uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, wd AS $$
  UPDATE api_key SET last_used_at = now()
   WHERE id = p_key AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')
$$;

CREATE TABLE webhook (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organization (id),
  url             text NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 500),
  events          text[] NOT NULL CHECK (cardinality(events) > 0),
  -- AES-256-GCM, key derived from the application signing key. Shown once in plain text.
  secret_enc      text NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  disabled_reason text,
  consecutive_failures int NOT NULL DEFAULT 0,
  created_by      uuid NOT NULL REFERENCES app_user (id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_org_idx ON webhook (org_id) WHERE active;
ALTER TABLE webhook ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_org ON webhook FOR ALL
  USING (wd.is_internal() OR org_id = wd.current_org())
  WITH CHECK (wd.is_internal() OR org_id = wd.current_org());

CREATE TABLE webhook_delivery (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id    uuid NOT NULL REFERENCES webhook (id) ON DELETE CASCADE,
  org_id        uuid NOT NULL REFERENCES organization (id),
  event_id      uuid NOT NULL,
  event_type    text NOT NULL,
  body          text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  attempts      int NOT NULL DEFAULT 0,
  last_status   int,
  last_error    text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (webhook_id, event_id)
);
CREATE INDEX webhook_delivery_due_idx ON webhook_delivery (next_attempt_at) WHERE status = 'pending';
CREATE INDEX webhook_delivery_hook_idx ON webhook_delivery (webhook_id, created_at DESC);
ALTER TABLE webhook_delivery ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_delivery_org ON webhook_delivery FOR SELECT
  USING (wd.is_internal() OR org_id = wd.current_org());
-- Only the worker (system context) creates and updates deliveries.
CREATE POLICY webhook_delivery_system ON webhook_delivery FOR ALL
  USING (wd.is_internal()) WITH CHECK (wd.is_internal());

GRANT SELECT, INSERT, UPDATE ON api_key, webhook TO wd_app;
GRANT DELETE ON webhook TO wd_app;
GRANT SELECT, INSERT, UPDATE ON webhook_delivery TO wd_app;
GRANT EXECUTE ON FUNCTION wd.resolve_api_key, wd.touch_api_key TO wd_app;
