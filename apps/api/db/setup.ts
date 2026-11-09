/**
 * One-shot database setup for container deployments (no shell in the distroless image):
 * applies pending migrations, then (unless SEED=false) syncs reference data, and demo tenants unless
 * SEED_DEMO=false (use that in production).
 */
import { migrateUp } from './migrate.js';
import { seedDownloadFiles } from './seed-downloads.js';
import { seed } from './seed.js';

const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error('DATABASE_OWNER_URL is required');
  process.exit(1);
}
try {
  const applied = await migrateUp(url);
  console.error(applied.length ? `applied ${applied.length} migration(s)` : 'schema up to date');
  if (process.env.SEED !== 'false') {
    const demo = process.env.SEED_DEMO !== 'false';
    await seed(url, { demo, log: (s) => console.error(s) });
    if (demo) await seedDownloadFiles();
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
