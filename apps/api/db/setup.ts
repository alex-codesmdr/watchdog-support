/**
 * One-shot database setup for container deployments (no shell in the distroless image):
 * applies pending migrations, then (unless SEED=false) syncs reference data and demo tenants.
 */
import { migrateUp } from './migrate.js';
import { seed } from './seed.js';

const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error('DATABASE_OWNER_URL is required');
  process.exit(1);
}
try {
  const applied = await migrateUp(url);
  console.error(applied.length ? `applied ${applied.length} migration(s)` : 'schema up to date');
  if (process.env.SEED !== 'false') await seed(url, { log: (s) => console.error(s) });
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
