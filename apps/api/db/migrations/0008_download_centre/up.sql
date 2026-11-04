-- 0008 download centre: releases (firmware, software, documents), files, EULAs, download audit.

CREATE TABLE eula (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version    text NOT NULL UNIQUE,
  title      text NOT NULL,
  body_html  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE software_release (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    uuid NOT NULL REFERENCES product_family (id),
  kind         text NOT NULL CHECK (kind IN ('firmware', 'software', 'release_notes', 'mib', 'document', 'tool')),
  title        text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  version      text NOT NULL CHECK (version ~ '^[A-Za-z0-9._-]{1,40}$'),
  -- public: anyone; registered: any signed-in customer/partner; entitled: active coverage on a
  -- compatible device; internal: WatchDog staff only.
  visibility   text NOT NULL DEFAULT 'entitled' CHECK (visibility IN ('public', 'registered', 'entitled', 'internal')),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'deprecated', 'withdrawn')),
  recommended  boolean NOT NULL DEFAULT false,
  released_on  date,
  notes_md     text NOT NULL DEFAULT '' CHECK (length(notes_md) <= 100000),
  notes_html   text NOT NULL DEFAULT '',
  eula_id      uuid REFERENCES eula (id),
  created_by   uuid NOT NULL REFERENCES app_user (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (family_id, kind, version)
);
CREATE INDEX software_release_list_idx ON software_release (status, family_id, released_on DESC);

-- Compatible models. No rows = every model in the family.
CREATE TABLE release_product (
  release_id uuid NOT NULL REFERENCES software_release (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES product (id),
  PRIMARY KEY (release_id, product_id)
);

CREATE TABLE release_file (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id     uuid NOT NULL REFERENCES software_release (id) ON DELETE CASCADE,
  file_name      text NOT NULL CHECK (file_name ~ '^[A-Za-z0-9._() -]{1,200}$'),
  size_bytes     bigint NOT NULL CHECK (size_bytes >= 0),
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  quarantine_key text,
  object_key     text,
  scan_status    text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'infected')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, file_name)
);

CREATE TABLE eula_acceptance (
  user_id     uuid NOT NULL REFERENCES app_user (id),
  eula_id     uuid NOT NULL REFERENCES eula (id),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, eula_id)
);

-- Who downloaded what (export-control and licence audits). Anonymous public downloads have no user.
CREATE TABLE download_event (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_id    uuid NOT NULL REFERENCES release_file (id),
  user_id    uuid REFERENCES app_user (id),
  org_id     uuid REFERENCES organization (id),
  ip         inet,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX download_event_file_idx ON download_event (file_id, at DESC);
CREATE INDEX download_event_org_idx ON download_event (org_id, at DESC);

-- Defence in depth: the API filters by audience, and RLS still hides internal and unpublished
-- releases from every non-staff session.
ALTER TABLE software_release ENABLE ROW LEVEL SECURITY;
CREATE POLICY release_read ON software_release FOR SELECT
  USING (wd.is_internal() OR (status IN ('published', 'deprecated') AND visibility <> 'internal'));
CREATE POLICY release_write ON software_release FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());

ALTER TABLE release_file ENABLE ROW LEVEL SECURITY;
CREATE POLICY release_file_read ON release_file FOR SELECT
  USING (EXISTS (SELECT 1 FROM software_release r WHERE r.id = release_id));
CREATE POLICY release_file_write ON release_file FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());

ALTER TABLE release_product ENABLE ROW LEVEL SECURITY;
CREATE POLICY release_product_read ON release_product FOR SELECT
  USING (EXISTS (SELECT 1 FROM software_release r WHERE r.id = release_id));
CREATE POLICY release_product_write ON release_product FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());

ALTER TABLE eula_acceptance ENABLE ROW LEVEL SECURITY;
CREATE POLICY eula_acceptance_own ON eula_acceptance FOR ALL
  USING (wd.is_internal() OR user_id = wd.current_user_id())
  WITH CHECK (user_id = wd.current_user_id());

ALTER TABLE download_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY download_event_read ON download_event FOR SELECT USING (wd.is_internal() OR wd.can_see_org(org_id));
CREATE POLICY download_event_insert ON download_event FOR INSERT WITH CHECK (true);

-- Does the current session's organisation (or a delegating customer) hold active coverage on a
-- device compatible with the release? Runs as the caller, so RLS scopes the devices it can see.
CREATE FUNCTION wd.entitled_to_release(p_release uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM entitlement e
      JOIN asset a ON a.id = e.asset_id
      JOIN product p ON p.id = a.product_id
      JOIN software_release r ON r.id = p_release
     WHERE e.starts_on <= current_date AND e.ends_on >= current_date
       AND p.family_id = r.family_id
       AND (NOT EXISTS (SELECT 1 FROM release_product rp WHERE rp.release_id = r.id)
            OR EXISTS (SELECT 1 FROM release_product rp WHERE rp.release_id = r.id AND rp.product_id = p.id)))
$$;

GRANT SELECT ON eula TO wd_app;
GRANT INSERT ON eula TO wd_app;
GRANT SELECT, INSERT, UPDATE ON software_release, release_file TO wd_app;
GRANT SELECT, INSERT, DELETE ON release_product TO wd_app;
GRANT SELECT, INSERT ON eula_acceptance, download_event TO wd_app;
GRANT EXECUTE ON FUNCTION wd.entitled_to_release TO wd_app;
