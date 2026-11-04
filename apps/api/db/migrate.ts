/**
 * Versioned, reversible SQL migrations.
 *   tsx db/migrate.ts up            apply all pending
 *   tsx db/migrate.ts down [n=1]    roll back the last n
 *   tsx db/migrate.ts status
 * Each migration is a folder NNNN_name/ with up.sql and down.sql, applied in one transaction.
 * Runs as the OWNER role (DATABASE_OWNER_URL); the app role can never alter schema.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DIR = fileURLToPath(new URL('./migrations', import.meta.url));

export interface Migration {
  id: string;
  up: string;
  down: string;
}

export function loadMigrations(dir = DIR): Migration[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}_[a-z0-9_]+$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .map((id) => ({
      id,
      up: readFileSync(join(dir, id, 'up.sql'), 'utf8'),
      down: readFileSync(join(dir, id, 'down.sql'), 'utf8'),
    }));
}

async function ensureTable(c: pg.Client) {
  await c.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
}

export async function migrateUp(url: string, log = console.log): Promise<string[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('SELECT pg_advisory_lock(726200999)');
    await ensureTable(c);
    const done = new Set(
      (await c.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map((r) => r.id),
    );
    const applied: string[] = [];
    for (const m of loadMigrations()) {
      if (done.has(m.id)) continue;
      await c.query('BEGIN');
      try {
        await c.query(m.up);
        await c.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
        await c.query('COMMIT');
        log(`  ↑ ${m.id}`);
        applied.push(m.id);
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`migration ${m.id} failed: ${(e as Error).message}`);
      }
    }
    return applied;
  } finally {
    await c.query('SELECT pg_advisory_unlock(726200999)').catch(() => undefined);
    await c.end();
  }
}

export async function migrateDown(url: string, steps = 1, log = console.log): Promise<string[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('SELECT pg_advisory_lock(726200999)');
    await ensureTable(c);
    const done = (
      await c.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id DESC LIMIT $1', [
        steps,
      ])
    ).rows;
    const all = new Map(loadMigrations().map((m) => [m.id, m]));
    const rolled: string[] = [];
    for (const { id } of done) {
      const m = all.get(id);
      if (!m) throw new Error(`migration ${id} is applied but missing on disk`);
      await c.query('BEGIN');
      try {
        await c.query(m.down);
        await c.query('DELETE FROM schema_migrations WHERE id = $1', [id]);
        await c.query('COMMIT');
        log(`  ↓ ${id}`);
        rolled.push(id);
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`rollback ${id} failed: ${(e as Error).message}`);
      }
    }
    return rolled;
  } finally {
    await c.query('SELECT pg_advisory_unlock(726200999)').catch(() => undefined);
    await c.end();
  }
}

async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is required for migrations');
  const [cmd = 'up', n] = process.argv.slice(2);
  if (cmd === 'up') {
    const a = await migrateUp(url);
    console.log(a.length ? `applied ${a.length} migration(s)` : 'up to date');
  } else if (cmd === 'down') {
    await migrateDown(url, Number(n ?? 1));
  } else if (cmd === 'status') {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await ensureTable(c);
    const done = new Set(
      (await c.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map((r) => r.id),
    );
    await c.end();
    for (const m of loadMigrations()) console.log(`${done.has(m.id) ? '[x]' : '[ ]'} ${m.id}`);
  } else {
    throw new Error(`unknown command ${cmd}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
