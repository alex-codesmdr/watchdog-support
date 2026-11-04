import { describe, expect, it } from 'vitest';
import { safeReturn } from './redirect';

describe('safeReturn', () => {
  it.each([
    ['/portal/cases/WD-2026-000001', '/portal/cases/WD-2026-000001'],
    ['/workspace?view=queue', '/workspace?view=queue'],
    ['//evil.example/x', '/portal'],
    ['https://evil.example', '/portal'],
    ['/\\evil.example', '/portal'],
    ['/auth/logout', '/portal'],
    [null, '/portal'],
  ])('%s -> %s', (input, out) => expect(safeReturn(input)).toBe(out));
});
