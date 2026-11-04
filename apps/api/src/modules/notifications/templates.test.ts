import { describe, expect, it } from 'vitest';
import { render } from './templates.js';

describe('email templates', () => {
  it('escapes user content and includes CTA + text part', async () => {
    const r = await render('case_created', { number: 'WD-2026-000001', subject: '<img src=x onerror=1>', severity: 'P1', firstResponseDue: '04 Nov 2026, 11:30', url: 'https://support.watchdog.example/portal/cases/WD-2026-000001' });
    expect(r.subject).toBe('[WD-2026-000001] Case opened: <img src=x onerror=1>');
    expect(r.html).not.toContain('<img src=x');
    expect(r.html).toContain('View case');
    expect(r.text).toContain('https://support.watchdog.example/portal/cases/WD-2026-000001');
  });
});
