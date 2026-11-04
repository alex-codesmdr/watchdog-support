import { committedFingerprints, scanFingerprints } from '@wd/brand-lint';
import { ProblemError } from './errors.js';

/**
 * Runtime brand guard for published content (advisories, articles, releases). Uses the same
 * one-way fingerprints as CI, so editors cannot publish a third-party vendor name by mistake.
 */
export function assertBrandClean(fields: Record<string, string | null | undefined>): void {
  const fp = committedFingerprints();
  const bad = Object.entries(fields)
    .filter(([, v]) => v && scanFingerprints(v, fp).length)
    .map(([k]) => k);
  if (bad.length)
    throw new ProblemError(
      422,
      'brand',
      'Only WatchDog names may appear in published content',
      `Remove the third-party vendor name from: ${bad.join(', ')}.`,
    );
}
