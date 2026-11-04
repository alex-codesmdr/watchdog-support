#!/usr/bin/env node
/**
 * Reads terms (one per line) on stdin and prints fingerprint lines for prohibited.sha256.
 * The plain terms are never written anywhere.   printf 'Term\n' | node dist/fingerprint-cli.js
 */
import { readFileSync } from 'node:fs';
import { fingerprintLine } from './fingerprints.js';

const lines = readFileSync(0, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);
// eslint-disable-next-line no-console -- CLI output
for (const l of lines) console.log(fingerprintLine(l));
