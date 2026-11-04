import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanPath, scanText, termToRegex } from './index.js';

// Fictitious stand-in terms. The real list is never committed.
const TERMS = ['acmenet', 'zx9'];

describe('brand-lint matching', () => {
  it.each([
    ['Powered by AcmeNet firmware', 1],
    ['ACME-NET switch', 1],
    ['acm3n3t', 1],
    ['A c m e N e t', 1],
    ['the zx9 platform', 1],
    ['ZX-9 router', 1],
    ['hash 4fzx9qa1 should not match', 0],
    ['acmenetwork is a different word', 0],
    ['WatchDog WD-SW5600 switch', 0],
  ])('%s -> %i', (text, n) => {
    expect(scanText(text, TERMS)).toHaveLength(n);
  });

  it('reports line and column and masks the term', () => {
    const [f] = scanText('line one\nfoo acmenet bar', TERMS);
    expect(f).toMatchObject({ line: 2, column: 5, term: 'a*****t' });
    expect(f!.excerpt).not.toMatch(/acmenet/i);
  });

  it('rejects terms that are too short', () => {
    expect(() => termToRegex('x')).toThrow();
  });

  it('scans directories, file names and honours ignores', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bl-'));
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'src', 'ok.ts'), 'export const brand = "WatchDog";');
    writeFileSync(join(dir, 'src', 'AcmeNet-image.bin'), 'binary');
    writeFileSync(join(dir, 'node_modules', 'x.js'), 'acmenet');
    const r = scanPath(dir, { terms: TERMS });
    expect(r.findings.map((f) => f.where)).toEqual(['filename']);
  });
});
