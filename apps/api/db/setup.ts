/**
 * One-shot database setup for container deployments (no shell in the distroless image):
 * applies pending migrations, then (unless SEED=false) syncs reference data and demo tenants.
 */
import { migrateUp } from './migrate.js';
import { apiEnvSchema } from '@wd/config';
import {
  FsObjectStore,
  S3ObjectStore,
  type ObjectStore,
} from '../src/modules/files/object-store.js';
import { Signer } from '../src/common/signing.js';
import { SEED_RELEASES, seedObjectKey } from './seed-downloads.js';
import { seed } from './seed.js';

/** Writes the starter download files to object storage (skipped when storage is not configured). */
async function seedDownloadFiles() {
  const parsed = apiEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('  download files skipped (API configuration incomplete)');
    return;
  }
  const cfg = parsed.data;
  let store: ObjectStore;
  if (cfg.STORAGE_DRIVER === 's3') {
    const s3 = new S3ObjectStore(cfg);
    if (cfg.S3_ENSURE_BUCKETS) await s3.ensureBuckets();
    store = s3;
  } else {
    store = new FsObjectStore(
      cfg.STORAGE_FS_ROOT,
      new Signer(cfg.APP_SIGNING_KEY),
      cfg.PUBLIC_API_URL,
    );
  }
  let n = 0;
  for (const r of SEED_RELEASES)
    for (const f of r.files) {
      const exists = await store
        .get('attachments', seedObjectKey(f.name))
        .then((s) => (s.destroy(), true))
        .catch(() => false);
      if (!exists) {
        await store.put('attachments', seedObjectKey(f.name), f.content());
        n++;
      }
    }
  if (n) console.error(`  ${n} download files written`);
}

const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error('DATABASE_OWNER_URL is required');
  process.exit(1);
}
try {
  const applied = await migrateUp(url);
  console.error(applied.length ? `applied ${applied.length} migration(s)` : 'schema up to date');
  if (process.env.SEED !== 'false') {
    await seed(url, { log: (s) => console.error(s) });
    await seedDownloadFiles();
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
