/**
 * Fingerprint matching: lets the repository carry the prohibited list WITHOUT containing the names.
 *
 * Each prohibited term is normalised (lower-case, look-alike characters folded, separators removed)
 * and stored only as SHA-256("wd-brand:" + normalised). The scanner splits text into alphanumeric
 * tokens, folds them the same way, and hashes every run of adjacent tokens up to the longest term. A run whose hash is
 * in the set is a finding. This catches "Name", "NAME", "Na-me", "N a m e" and digit look-alikes,
 * and never matches inside a longer word (tokens are whole words).
 *
 * Generate a fingerprint file locally (never commit the plain list):
 *   echo "Term One" | node dist/fingerprint-cli.js >> prohibited.sha256
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FOLD: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  l: 'i',
  '!': 'i',
  '|': 'i',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '5': 's',
  $: 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '2': 'z',
};
const MAX_WINDOW = 16; // allows spelled-out "N a m e"; bounded by maxLen below

export function fold(s: string): string {
  return [...s.toLowerCase()]
    .map((c) => FOLD[c] ?? c)
    .filter((c) => /[a-z]/.test(c))
    .join('');
}

export function fingerprint(term: string): string {
  const f = fold(term);
  if (f.length < 2) throw new Error('brand-lint: term too short');
  return createHash('sha256').update(`wd-brand:${f}`).digest('hex');
}

export interface Fingerprints {
  hashes: Set<string>;
  minLen: number;
  maxLen: number;
}

/** Parses a fingerprint file: `<sha256> <normalised-length>` per line, `#` comments allowed. */
export function parseFingerprints(text: string): Fingerprints {
  const hashes = new Set<string>();
  let minLen = Infinity;
  let maxLen = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-f0-9]{64})\s+(\d+)$/.exec(line);
    if (!m) throw new Error(`brand-lint: bad fingerprint line "${line.slice(0, 20)}…"`);
    hashes.add(m[1]!);
    minLen = Math.min(minLen, Number(m[2]));
    maxLen = Math.max(maxLen, Number(m[2]));
  }
  return { hashes, minLen, maxLen };
}

export function fingerprintLine(term: string): string {
  return `${fingerprint(term)} ${fold(term).length}`;
}

export interface FpHit {
  index: number;
  length: number;
}

/** Returns character offsets of matching token runs. */
export function scanFingerprints(text: string, fp: Fingerprints): FpHit[] {
  if (!fp.hashes.size) return [];
  const tokens: Array<{ start: number; end: number; folded: string }> = [];
  const re = /[A-Za-z0-9@$!|]+/g;
  for (const m of text.matchAll(re)) {
    tokens.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, folded: fold(m[0]) });
  }
  const hits: FpHit[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let joined = '';
    for (let w = 0; w < MAX_WINDOW && i + w < tokens.length; w++) {
      const t = tokens[i + w]!;
      // adjacent tokens must be separated by at most 2 characters (e.g. "Na - me", "N.a.m.e")
      if (w > 0 && t.start - tokens[i + w - 1]!.end > 2) break;
      joined += t.folded;
      if (joined.length > fp.maxLen) break;
      if (joined.length < fp.minLen) continue;
      const h = createHash('sha256').update(`wd-brand:${joined}`).digest('hex');
      if (fp.hashes.has(h))
        hits.push({ index: tokens[i]!.start, length: t.end - tokens[i]!.start });
    }
  }
  return hits;
}

let committed: Fingerprints | undefined;
/**
 * The committed fingerprint list shipped with this package (prohibited.sha256), for runtime guards
 * in the API. Override with WD_PROHIBITED_FINGERPRINTS_FILE.
 */
export function committedFingerprints(): Fingerprints {
  committed ??= parseFingerprints(
    readFileSync(
      process.env.WD_PROHIBITED_FINGERPRINTS_FILE ??
        fileURLToPath(new URL('../prohibited.sha256', import.meta.url)),
      'utf8',
    ),
  );
  return committed;
}
