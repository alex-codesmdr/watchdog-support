-- 0002 product catalog, sites, assets, entitlements, business calendars and SLA policies.

-- ---------------------------------------------------------------- catalog (global, not tenant data)
CREATE TABLE product_family (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9-]+$'),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  sort_order  int NOT NULL DEFAULT 0
);

CREATE TABLE product (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        uuid NOT NULL REFERENCES product_family (id),
  sku              text NOT NULL UNIQUE,
  model_name       text NOT NULL,
  description      text NOT NULL DEFAULT '',
  lifecycle        text NOT NULL DEFAULT 'ga' CHECK (lifecycle IN ('ga', 'eos_announced', 'eos', 'eol')),
  eos_date         date,
  eol_date         date,
  specs            jsonb NOT NULL DEFAULT '{}',
  -- INTERNAL ONLY: upstream mapping for PSIRT/RMA. Column privilege is withheld from wd_app below,
  -- so even `SELECT *` by the API fails; read only through wd.product_internal_ref().
  internal_oem_ref text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_family_idx ON product (family_id);

CREATE FUNCTION wd.product_internal_ref(p_sku text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, wd AS $$
BEGIN
  IF NOT wd.is_internal() THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT internal_oem_ref FROM product WHERE sku = p_sku);
END $$;
REVOKE ALL ON FUNCTION wd.product_internal_ref FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wd.product_internal_ref TO wd_app;

-- ---------------------------------------------------------------- sites & assets (tenant data)
CREATE TABLE site (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organization (id),
  name       text NOT NULL,
  address    text,
  city       text,
  state      text,
  pincode    text CHECK (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
ALTER TABLE site ENABLE ROW LEVEL SECURITY;
CREATE POLICY site_read ON site FOR SELECT USING (wd.can_see_org(org_id));
CREATE POLICY site_write ON site FOR ALL USING (wd.is_internal() OR org_id = wd.current_org())
  WITH CHECK (wd.is_internal() OR org_id = wd.current_org());

CREATE TABLE asset (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organization (id),
  site_id         uuid REFERENCES site (id),
  product_id      uuid NOT NULL REFERENCES product (id),
  -- Serial numbers are WatchDog-issued and globally unique.
  serial_number   text NOT NULL UNIQUE CHECK (serial_number ~ '^[A-Z0-9-]{6,32}$'),
  mac             macaddr,
  purchase_date   date,
  current_version text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX asset_org_site_idx ON asset (org_id, site_id);
ALTER TABLE asset ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_read ON asset FOR SELECT USING (wd.can_see_org(org_id));
CREATE POLICY asset_write ON asset FOR ALL USING (wd.is_internal() OR org_id = wd.current_org())
  WITH CHECK (wd.is_internal() OR org_id = wd.current_org());

CREATE TABLE entitlement (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organization (id),
  asset_id     uuid NOT NULL REFERENCES asset (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('warranty', 'amc', 'subscription')),
  tier         text NOT NULL CHECK (tier IN ('standard', 'premium', 'mission_critical')),
  starts_on    date NOT NULL,
  ends_on      date NOT NULL,
  contract_ref text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  EXCLUDE USING gist (asset_id WITH =, kind WITH =, daterange(starts_on, ends_on, '[]') WITH &&)
);
CREATE INDEX entitlement_asset_idx ON entitlement (asset_id, ends_on DESC);
CREATE INDEX entitlement_expiry_idx ON entitlement (ends_on);
ALTER TABLE entitlement ENABLE ROW LEVEL SECURITY;
CREATE POLICY entitlement_read ON entitlement FOR SELECT USING (wd.can_see_org(org_id));
CREATE POLICY entitlement_write ON entitlement FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());

-- Public warranty check: coverage only — never the owning organisation, site or contract.
CREATE FUNCTION wd.warranty_lookup(p_serial text)
RETURNS TABLE (model_name text, kind text, tier text, ends_on date, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, wd AS $$
  SELECT p.model_name, e.kind, e.tier, e.ends_on, (current_date BETWEEN e.starts_on AND e.ends_on)
  FROM asset a JOIN product p ON p.id = a.product_id
  LEFT JOIN entitlement e ON e.asset_id = a.id
  WHERE a.serial_number = upper(p_serial)
  ORDER BY e.ends_on DESC NULLS LAST
  LIMIT 5
$$;
REVOKE ALL ON FUNCTION wd.warranty_lookup FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wd.warranty_lookup TO wd_app;

-- ---------------------------------------------------------------- calendars & SLA policies (global config)
CREATE TABLE business_calendar (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL UNIQUE,
  name               text NOT NULL,
  time_zone          text NOT NULL DEFAULT 'Asia/Kolkata',
  twenty_four_seven  boolean NOT NULL DEFAULT false,
  weekly             jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE calendar_holiday (
  calendar_id uuid NOT NULL REFERENCES business_calendar (id) ON DELETE CASCADE,
  day         date NOT NULL,
  name        text NOT NULL,
  PRIMARY KEY (calendar_id, day)
);
CREATE TABLE sla_policy (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier        text NOT NULL CHECK (tier IN ('standard', 'premium', 'mission_critical')),
  version     int NOT NULL DEFAULT 1,
  calendar_id uuid NOT NULL REFERENCES business_calendar (id),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tier, version)
);
CREATE UNIQUE INDEX sla_policy_active_uq ON sla_policy (tier) WHERE active;
CREATE TABLE sla_target (
  policy_id          uuid NOT NULL REFERENCES sla_policy (id) ON DELETE CASCADE,
  severity           text NOT NULL CHECK (severity IN ('P1', 'P2', 'P3', 'P4')),
  first_response_min int NOT NULL CHECK (first_response_min > 0),
  update_every_min   int NOT NULL CHECK (update_every_min > 0),
  restoration_min    int CHECK (restoration_min > 0),
  resolution_min     int NOT NULL CHECK (resolution_min > 0),
  round_the_clock    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (policy_id, severity)
);

GRANT SELECT ON product_family TO wd_app;
-- Column-level grant: every product column EXCEPT internal_oem_ref.
GRANT SELECT (id, family_id, sku, model_name, description, lifecycle, eos_date, eol_date, specs, created_at) ON product TO wd_app;
GRANT SELECT, INSERT, UPDATE ON site, asset TO wd_app;
GRANT SELECT, INSERT, UPDATE ON entitlement TO wd_app;
GRANT SELECT ON business_calendar, calendar_holiday, sla_policy, sla_target TO wd_app;
