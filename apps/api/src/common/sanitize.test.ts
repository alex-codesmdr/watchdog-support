import { describe, expect, it } from 'vitest';
import { htmlToText, sanitizeRichText, textToHtml } from './sanitize.js';

describe('sanitize', () => {
  it('escapes markup in plain text and keeps code blocks', () => {
    const html = textToHtml('Hi <script>alert(1)</script>\n\n```\nshow run | inc <b>\n```\nUse `ping`');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<pre><code>show run | inc &lt;b&gt;</code></pre>');
    expect(html).toContain('<code>ping</code>');
  });
  it('strips dangerous attributes and schemes', () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)" onclick="x()">x</a><img src=x onerror=alert(1)>');
    expect(out).not.toMatch(/javascript:|onclick|onerror/);
  });
  it('converts html to text', () => {
    expect(htmlToText('<p>a &amp; b</p><p>c<br>d</p>')).toBe('a & b\n\nc\nd');
  });
});
