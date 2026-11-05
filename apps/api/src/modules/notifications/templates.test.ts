import { describe, expect, it } from 'vitest';
import { render } from './templates.js';

describe('email templates', () => {
  it('escapes user content and includes CTA + text part', async () => {
    const r = await render('case_created', {
      number: 'WD-2026-000001',
      subject: '<img src=x onerror=1>',
      severity: 'P1',
      firstResponseDue: '04 Nov 2026, 11:30',
      url: 'https://support.watchdog.example/portal/cases/WD-2026-000001',
    });
    expect(r.subject).toBe('[WD-2026-000001] Case opened: <img src=x onerror=1>');
    expect(r.html).not.toContain('<img src=x');
    expect(r.html).toContain('View case');
    expect(r.text).toContain('https://support.watchdog.example/portal/cases/WD-2026-000001');
  });
});

describe('Hindi templates', () => {
  it('every English template has a Hindi version with the same placeholders', async () => {
    const mod = await import('./templates.js');
    const keys = mod.TEMPLATE_KEYS;
    for (const k of keys) {
      const en = await render(k, {}, 'en-IN');
      const hi = await render(k, {}, 'hi-IN');
      expect(hi.subject, k).not.toBe('');
      expect(mod.placeholders(k, 'hi'), k).toEqual(mod.placeholders(k, 'en'));
      expect(hi.html, k).toContain('lang="hi"');
      expect(en.html, k).toContain('lang="en"');
    }
  });

  it('renders Hindi for hi-IN and falls back to English for unknown languages', async () => {
    const v = {
      number: 'WD-2026-000001',
      subject: 'Link down',
      severity: 'P1',
      firstResponseDue: '5 Nov',
      url: 'https://x.example/c',
    };
    const hi = await render('case_created', v, 'hi-IN');
    expect(hi.subject).toBe('[WD-2026-000001] case खोला गया: Link down');
    expect(hi.text).toContain('case देखें: https://x.example/c');
    expect(hi.html).toContain('Apollo Infoways Pvt. Ltd.');
    const fr = await render('case_created', v, 'fr-FR');
    expect(fr.subject).toBe('[WD-2026-000001] Case opened: Link down');
  });
});
