#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  loadTerms,
  parseFingerprints,
  scanPath,
  scanText,
  type Finding,
  type Fingerprints,
} from './index.js';

/**
 * Usage:
 *   wd-brand-lint [--require-terms] [--stdin] <path>...
 * Exit codes: 0 clean, 1 findings, 2 misconfiguration.
 */
const args = process.argv.slice(2);
const requireTerms = args.includes('--require-terms') || process.env.CI === 'true';
const fromStdin = args.includes('--stdin');
const paths = args.filter((a) => !a.startsWith('--'));

const terms = loadTerms();
// Committed one-way fingerprints (no names in the repo). Override with WD_PROHIBITED_FINGERPRINTS_FILE.
const fpFile =
  process.env.WD_PROHIBITED_FINGERPRINTS_FILE ??
  fileURLToPath(new URL('../prohibited.sha256', import.meta.url));
const fingerprints: Fingerprints | undefined = existsSync(fpFile)
  ? parseFingerprints(readFileSync(fpFile, 'utf8'))
  : undefined;
const total = terms.length + (fingerprints?.hashes.size ?? 0);
if (total === 0) {
  const msg =
    'brand-lint: no prohibited terms configured (prohibited.sha256, WD_PROHIBITED_TERMS or WD_PROHIBITED_TERMS_FILE).';
  if (requireTerms) {
    console.error(`${msg} Refusing to pass in CI.`);
    process.exit(2);
  }
  console.warn(`${msg} Skipping.`);
  process.exit(0);
}

const ignoreFile = '.brandlintignore';
const ignore = existsSync(ignoreFile)
  ? readFileSync(ignoreFile, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  : [];

let findings: Finding[] = [];
let files = 0;
if (fromStdin) {
  findings = scanText(readFileSync(0, 'utf8'), terms, '<stdin>', fingerprints);
  files = 1;
}
for (const p of paths.length || fromStdin ? paths : ['.']) {
  const r = scanPath(p, { terms, ignore, fingerprints });
  files += r.files;
  findings.push(...r.findings);
}

if (findings.length) {
  for (const f of findings)
    console.error(
      `${f.file}:${f.line}:${f.column}  [${f.where}] prohibited term ${f.term}  …${f.excerpt}…`,
    );
  console.error(`\nbrand-lint: ${findings.length} finding(s) in ${files} file(s) scanned.`);
  process.exit(1);
}
// eslint-disable-next-line no-console -- CLI output
console.log(`brand-lint: clean (${files} files, ${total} terms).`);
