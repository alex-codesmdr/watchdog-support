-- 0005 knowledge base: articles, immutable versions, product tagging, feedback, full-text + fuzzy search.
-- KB content is WatchDog-owned (not tenant data); visibility is enforced per request by audience.

CREATE TABLE kb_article (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 120),
  type                 text NOT NULL CHECK (type IN ('howto', 'troubleshooting', 'config_guide', 'faq', 'known_issue', 'best_practice')),
  visibility           text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'registered', 'partner', 'internal')),
  state                text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'review', 'published', 'archived')),
  family_id            uuid REFERENCES product_family (id),
  current_version      int NOT NULL DEFAULT 1,
  published_version    int,
  -- Denormalised from the published version for fast search (rebuilt on publish).
  title                text,
  summary              text,
  search_vec           tsvector,
  firmware_versions    text[] NOT NULL DEFAULT '{}',
  views                int NOT NULL DEFAULT 0,
  helpful              int NOT NULL DEFAULT 0,
  not_helpful          int NOT NULL DEFAULT 0,
  source_case_id       uuid REFERENCES support_case (id),
  created_by           uuid NOT NULL REFERENCES app_user (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  published_at         timestamptz
);
CREATE INDEX kb_article_search_idx ON kb_article USING gin (search_vec) WHERE state = 'published';
CREATE INDEX kb_article_title_trgm_idx ON kb_article USING gin (title gin_trgm_ops) WHERE state = 'published';
CREATE INDEX kb_article_facets_idx ON kb_article (state, visibility, type, family_id);
CREATE TRIGGER kb_article_touch BEFORE UPDATE ON kb_article FOR EACH ROW EXECUTE FUNCTION wd.touch_updated_at();

CREATE TABLE kb_version (
  article_id   uuid NOT NULL REFERENCES kb_article (id) ON DELETE CASCADE,
  version      int NOT NULL,
  title        text NOT NULL CHECK (length(title) BETWEEN 8 AND 200),
  summary      text NOT NULL CHECK (length(summary) <= 500),
  body_md      text NOT NULL CHECK (length(body_md) <= 200000),
  author_id    uuid NOT NULL REFERENCES app_user (id),
  reviewer_id  uuid REFERENCES app_user (id),
  change_note  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, version)
);

CREATE TABLE kb_article_product (
  article_id uuid NOT NULL REFERENCES kb_article (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES product (id),
  PRIMARY KEY (article_id, product_id)
);
CREATE INDEX kb_article_product_product_idx ON kb_article_product (product_id);

CREATE TABLE kb_feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES kb_article (id) ON DELETE CASCADE,
  user_id    uuid REFERENCES app_user (id),
  helpful    boolean NOT NULL,
  comment    text CHECK (length(comment) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kb_feedback_article_idx ON kb_feedback (article_id, created_at DESC);

-- Weighted document: title (A) > summary (B) > body (C). 'english' stemming; 'simple' copy of the
-- title keeps model numbers and error codes (e.g. SW5600, %DEV/1/REBOOT) searchable verbatim.
CREATE FUNCTION wd.kb_document(p_title text, p_summary text, p_body text, p_fw text[]) RETURNS tsvector
LANGUAGE sql IMMUTABLE AS $$
  SELECT setweight(to_tsvector('english', coalesce(p_title, '')), 'A')
      || setweight(to_tsvector('simple', coalesce(p_title, '')), 'A')
      || setweight(to_tsvector('english', coalesce(p_summary, '')), 'B')
      || setweight(to_tsvector('simple', array_to_string(p_fw, ' ')), 'B')
      || setweight(to_tsvector('english', left(coalesce(p_body, ''), 100000)), 'C')
$$;

GRANT SELECT, INSERT, UPDATE ON kb_article, kb_version, kb_article_product TO wd_app;
GRANT DELETE ON kb_article_product TO wd_app;
GRANT SELECT, INSERT ON kb_feedback TO wd_app;
GRANT EXECUTE ON FUNCTION wd.kb_document TO wd_app;
