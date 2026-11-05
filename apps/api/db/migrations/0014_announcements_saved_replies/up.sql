-- 0014: portal announcements (banners) and engineers' saved replies.

CREATE TABLE announcement (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  body        text NOT NULL DEFAULT '' CHECK (length(body) <= 500),
  link_url    text CHECK (link_url ~ '^(/|https://)' AND length(link_url) <= 500),
  tone        text NOT NULL DEFAULT 'info' CHECK (tone IN ('info', 'maintenance', 'incident')),
  audience    text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'customers', 'staff')),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz CHECK (ends_at IS NULL OR ends_at > starts_at),
  created_by  uuid NOT NULL REFERENCES app_user (id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER announcement_touch BEFORE UPDATE ON announcement FOR EACH ROW EXECUTE FUNCTION wd.touch_updated_at();
CREATE INDEX announcement_window_idx ON announcement (starts_at, ends_at);
ALTER TABLE announcement ENABLE ROW LEVEL SECURITY;
-- Visitors see "everyone"; signed-in customers also see "customers"; staff see all (to manage them).
CREATE POLICY announcement_read ON announcement FOR SELECT USING (
  wd.is_internal()
  OR (starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
      AND (audience = 'everyone' OR (audience = 'customers' AND wd.current_user_id() IS NOT NULL)))
);
CREATE POLICY announcement_write ON announcement FOR ALL USING (wd.is_internal()) WITH CHECK (wd.is_internal());

-- owner_id NULL = shared with every engineer; otherwise personal to the owner.
CREATE TABLE saved_reply (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid REFERENCES app_user (id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (length(title) BETWEEN 3 AND 80),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_by  uuid NOT NULL REFERENCES app_user (id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER saved_reply_touch BEFORE UPDATE ON saved_reply FOR EACH ROW EXECUTE FUNCTION wd.touch_updated_at();
CREATE INDEX saved_reply_owner_idx ON saved_reply (owner_id, title);
ALTER TABLE saved_reply ENABLE ROW LEVEL SECURITY;
CREATE POLICY saved_reply_staff ON saved_reply FOR ALL
  USING (wd.is_internal() AND (owner_id IS NULL OR owner_id = wd.current_user_id()))
  WITH CHECK (wd.is_internal() AND (owner_id IS NULL OR owner_id = wd.current_user_id()));

GRANT SELECT, INSERT, UPDATE ON announcement TO wd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_reply TO wd_app;
