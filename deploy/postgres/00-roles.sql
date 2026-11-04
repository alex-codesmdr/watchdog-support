-- Cluster bootstrap: run once per environment by a DBA / the compose init hook.
-- wd_owner owns the schema and runs migrations. wd_app is what the API and workers use:
-- it does NOT own tables and does NOT have BYPASSRLS, so row-level security always applies.
-- Passwords here are local-dev only; production passwords come from the secret store.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wd_owner') THEN
    CREATE ROLE wd_owner LOGIN PASSWORD 'wd_owner_dev' NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wd_app') THEN
    CREATE ROLE wd_app LOGIN PASSWORD 'wd_app_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
SELECT 'CREATE DATABASE watchdog OWNER wd_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'watchdog')\gexec
\connect watchdog
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO wd_owner;
GRANT USAGE ON SCHEMA public TO wd_app;
