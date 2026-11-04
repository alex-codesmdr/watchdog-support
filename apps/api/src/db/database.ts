import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { DB as Schema } from './schema.js';
import type { Principal } from '../common/principal.js';

export type Tx = Transaction<Schema>;
export type Kdb = Kysely<Schema>;

// Return bigint/numeric as strings (never lose precision), dates as Date.
pg.types.setTypeParser(20, (v) => v);

export const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
export const INTERNAL_ORG_ID = '00000000-0000-4000-8000-000000000100';

/**
 * The only way application code reaches the database. The raw Kysely instance is private so
 * nothing can run a query outside a transaction that carries tenant context (ADR-004).
 */
export class Database {
  readonly #db: Kdb;
  readonly #pool: pg.Pool;

  constructor(url: string, max = 20) {
    this.#pool = new pg.Pool({ connectionString: url, max, statement_timeout: 15_000, application_name: 'wd-api' });
    this.#db = new Kysely<Schema>({ dialect: new PostgresDialect({ pool: this.#pool }) });
  }

  /** Runs `fn` inside a transaction scoped to the caller's tenant context (RLS applies). */
  withTenant<T>(p: Pick<Principal, 'userId' | 'orgId' | 'delegatedOrgIds' | 'isInternal'>, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.#db.transaction().execute(async (tx) => {
      await sql`SELECT set_config('app.user_id', ${p.userId}, true),
                       set_config('app.org_id', ${p.orgId}, true),
                       set_config('app.delegated_orgs', ${p.delegatedOrgIds.join(',')}, true),
                       set_config('app.is_internal', ${p.isInternal ? 'true' : 'false'}, true)`.execute(tx);
      return fn(tx);
    });
  }

  /** Background work (workers, inbound email): internal staff context as the system user. */
  withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.withTenant({ userId: SYSTEM_USER_ID, orgId: INTERNAL_ORG_ID, delegatedOrgIds: [], isInternal: true }, fn);
  }

  /** Unauthenticated public endpoints: no tenant context at all — RLS returns nothing tenant-scoped. */
  withAnonymous<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.#db.transaction().execute(fn);
  }

  /** Boot-time guard: the API must never run as a role that owns tables or bypasses RLS. */
  async assertSafeRole(): Promise<void> {
    const r = await sql<{ owner: boolean; bypass: boolean; superuser: boolean; user: string }>`
      SELECT current_user AS user,
             EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user) AS owner,
             (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser`.execute(this.#db);
    const row = r.rows[0]!;
    if (row.owner || row.bypass || row.superuser)
      throw new Error(`refusing to start: database role "${row.user}" owns tables or bypasses row-level security`);
  }

  async ping(): Promise<void> {
    await sql`SELECT 1`.execute(this.#db);
  }

  async close(): Promise<void> {
    await this.#db.destroy();
  }
}
