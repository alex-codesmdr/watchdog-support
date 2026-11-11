import pg from 'pg';
import { migrateUp } from '../db/migrate.js';
import { seed } from '../db/seed.js';

/**
 * Creates a throw-away database for the integration suite: real PostgreSQL, real RLS, real roles.
 * TEST_PG_ADMIN_URL must be a superuser/maintenance connection (CI: the postgres service container).
 */
export default async function setup() {
  const admin = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres@localhost:5432/postgres';
  const host = new URL(admin);
  const db = process.env.TEST_DB_NAME ?? 'watchdog_test';
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wd_owner') THEN CREATE ROLE wd_owner LOGIN PASSWORD 'wd_owner_dev' NOBYPASSRLS; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wd_app') THEN CREATE ROLE wd_app LOGIN PASSWORD 'wd_app_dev' NOBYPASSRLS; END IF;
  END $$`);
  await c.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${db} OWNER wd_owner`);
  await c.end();
  const c2 = new pg.Client({
    connectionString: Object.assign(new URL(admin), { pathname: `/${db}` }).toString(),
  });
  await c2.connect();
  await c2.query(
    'REVOKE ALL ON SCHEMA public FROM PUBLIC; ALTER SCHEMA public OWNER TO wd_owner; GRANT USAGE ON SCHEMA public TO wd_app;',
  );
  await c2.end();

  const owner = `postgres://wd_owner:wd_owner_dev@${host.host}/${db}`;
  await migrateUp(owner, () => undefined);
  await seed(owner, { log: () => undefined });
  // The demo roster depends on the time of day; tests that need shifts create their own.
  const c3 = new pg.Client({ connectionString: owner });
  await c3.connect();
  await c3.query('DELETE FROM oncall_shift');
  await c3.end();
  process.env.TEST_DATABASE_URL = `postgres://wd_app:wd_app_dev@${host.host}/${db}`;
  process.env.TEST_DATABASE_OWNER_URL = owner;
}
