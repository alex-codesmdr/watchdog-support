/**
 * @wd/brand-lint — fails the build when a prohibited third-party brand name appears anywhere
 * customer-facing: source, seeds, migrations, built HTML/JS, OpenAPI, emails, PDFs (text layer)
 * and file names.
 *
 * The prohibited list is NEVER committed in plain text. Two sources, combined:
 *   1. prohibited.sha256 (committed) — one-way fingerprints only, see fingerprints.ts
 *   2. WD_PROHIBITED_TERMS="term1,term2" or WD_PROHIBITED_TERMS_FILE=/path (optional, local/secret) Matching is case-insensitive, tolerant of look-alike characters
 * (0/o, 1/l/i, 3/e, 4/a, 5/s, 7/t, @/a, $/s) and of up to two separator characters between letters,
 * and anchored on alphanumeric boundaries so hashes and base64 blobs do not false-positive.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { scanFingerprints, type Fingerprints } from './fingerprints.js';
export * from './fingerprints.js';

const LOOKALIKE: Record<string, string> = {
  a: 'a4@',
  b: 'b8',
  e: 'e3',
  g: 'g9',
  i: 'i1l!|',
  l: 'l1i|',
  o: 'o0',
  s: 's5$',
  t: 't7',
  z: 'z2',
  '0': '0o',
  '1': '1il',
  '3': '3e',
  '4': '4a',
  '5': '5s',
  '7': '7t',
  '8': '8b',
};
const escapeClass = (s: string) => s.replace(/[\\\]^-]/g, (c) => `\\${c}`);

export function termToRegex(term: string): RegExp {
  const chars = [...term.toLowerCase().replace(/[^a-z0-9]/g, '')];
  if (chars.length < 2) throw new Error(`brand-lint: term too short: "${term}"`);
  const body = chars.map((c) => `[${escapeClass(LOOKALIKE[c] ?? c)}]`).join('[\\s._\\-]{0,2}');
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, 'gi');
}

export interface Finding {
  file: string;
  line: number;
  column: number;
  term: string;
  excerpt: string;
  where: 'content' | 'filename';
}

export function scanText(
  text: string,
  terms: readonly string[],
  file = '<text>',
  fp?: Fingerprints,
): Finding[] {
  const out: Finding[] = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const pos = (idx: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= idx) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: idx - lineStarts[lo]! + 1 };
  };
  if (fp) {
    for (const h of scanFingerprints(text, fp)) {
      out.push({
        file,
        ...pos(h.index),
        term: '[fingerprinted term]',
        excerpt: '(context hidden)',
        where: 'content',
      });
    }
  }
  for (const term of terms) {
    const re = termToRegex(term);
    for (const m of text.matchAll(re)) {
      const idx = m.index ?? 0;
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid]! <= idx) lo = mid;
        else hi = mid - 1;
      }
      out.push({
        file,
        line: lo + 1,
        column: idx - lineStarts[lo]! + 1,
        term: mask(term),
        excerpt: redact(text.slice(Math.max(0, idx - 30), idx + m[0].length + 30), re),
        where: 'content',
      });
    }
  }
  return out;
}

/** Findings never print the term in full, so CI logs do not leak the list either. */
const mask = (t: string) =>
  t.length <= 2 ? '**' : `${t[0]}${'*'.repeat(t.length - 2)}${t[t.length - 1]}`;
const redact = (s: string, re: RegExp) =>
  s.replace(new RegExp(re.source, 'gi'), (x) => mask(x)).replace(/\s+/g, ' ');

const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.json',
  '.yaml',
  '.yml',
  '.md',
  '.mdx',
  '.sql',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.txt',
  '.csv',
  '.xml',
  '.svg',
  '.mjml',
  '.hbs',
  '.env',
  '.example',
  '.toml',
  '.properties',
  '.conf',
  '.rss',
  '.map',
  '.tf',
  '.tpl',
  '',
]);
const DEFAULT_IGNORES = [
  'node_modules',
  '.git',
  '.turbo',
  'coverage',
  '.next/cache',
  'pnpm-lock.yaml',
];
const MAX_BYTES = 20 * 1024 * 1024;

export interface ScanOptions {
  terms: readonly string[];
  ignore?: readonly string[];
  fingerprints?: Fingerprints;
}

export function scanPath(root: string, opts: ScanOptions): { files: number; findings: Finding[] } {
  const ignores = [...DEFAULT_IGNORES, ...(opts.ignore ?? [])];
  const findings: Finding[] = [];
  let files = 0;
  const walk = (p: string) => {
    const rel = relative(root, p).split(sep).join('/');
    if (
      rel &&
      ignores.some((i) => rel === i || rel.startsWith(`${i}/`) || rel.split('/').includes(i))
    )
      return;
    const st = statSync(p);
    const base = rel.split('/').pop() ?? '';
    for (const f of scanText(base, opts.terms, rel || p, opts.fingerprints))
      findings.push({ ...f, where: 'filename' });
    if (st.isDirectory()) {
      for (const e of readdirSync(p)) walk(join(p, e));
      return;
    }
    if (!st.isFile() || st.size > MAX_BYTES) return;
    if (!TEXT_EXT.has(extname(p).toLowerCase())) return;
    files++;
    findings.push(...scanText(readFileSync(p, 'utf8'), opts.terms, rel, opts.fingerprints));
  };
  walk(root);
  return { files, findings };
}

export function loadTerms(env: Record<string, string | undefined> = process.env): string[] {
  const list: string[] = [];
  if (env.WD_PROHIBITED_TERMS) list.push(...env.WD_PROHIBITED_TERMS.split(','));
  if (env.WD_PROHIBITED_TERMS_FILE)
    list.push(...readFileSync(env.WD_PROHIBITED_TERMS_FILE, 'utf8').split(/\r?\n/));
  return [...new Set(list.map((t) => t.trim()).filter((t) => t && !t.startsWith('#')))];
}
