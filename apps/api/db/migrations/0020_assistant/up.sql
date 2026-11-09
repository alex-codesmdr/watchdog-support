-- 0020: help assistant questions, kept 90 days to improve the knowledge base.
CREATE TABLE assistant_query (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES organization (id) ON DELETE CASCADE,
  user_id     uuid REFERENCES app_user (id) ON DELETE SET NULL,
  question    text NOT NULL CHECK (length(question) <= 500),
  sources     text[] NOT NULL DEFAULT '{}',
  found       boolean NOT NULL,
  mode        text NOT NULL CHECK (mode IN ('extractive', 'generative')),
  helpful     boolean,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_query_created_idx ON assistant_query (created_at);
ALTER TABLE assistant_query ENABLE ROW LEVEL SECURITY;
-- Anyone may record a question; only staff read them (to find gaps in the knowledge base).
CREATE POLICY assistant_query_insert ON assistant_query FOR INSERT
  WITH CHECK (user_id IS NOT DISTINCT FROM wd.current_user_id());
CREATE POLICY assistant_query_read ON assistant_query FOR SELECT USING (wd.is_internal());
GRANT SELECT, INSERT ON assistant_query TO wd_app;

-- Feedback on your own answer (or an anonymous one, by its unguessable id).
CREATE FUNCTION wd.assistant_feedback(p_id uuid, p_helpful boolean) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER SET search_path = public, wd AS $$
  UPDATE assistant_query SET helpful = p_helpful
   WHERE id = p_id AND helpful IS NULL AND created_at > now() - interval '1 day'
     AND (user_id IS NULL OR user_id = wd.current_user_id())
  RETURNING true;
$$;
REVOKE ALL ON FUNCTION wd.assistant_feedback(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wd.assistant_feedback(uuid, boolean) TO wd_app;
