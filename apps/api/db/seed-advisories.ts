/**
 * One demo advisory so the public page is not empty in development. It is labelled as a demo and
 * carries no CVE ID: real advisories come only from the PSIRT workflow.
 */
import type pg from 'pg';
import { renderMarkdown } from '../src/modules/kb/markdown.js';

type Q = (t: string, v?: unknown[]) => Promise<pg.QueryResult>;

export async function seedAdvisories(q: Q, authorId: string): Promise<number> {
  if ((await q('SELECT 1 FROM advisory LIMIT 1')).rowCount) return 0;
  const body = `The web management interface accepted requests without checking the session's
anti-forgery token on two diagnostic pages. An attacker who tricks a signed-in administrator into
opening a crafted page could start a ping or traceroute from the switch.

No configuration change or data disclosure is possible through these pages.`;
  const workaround =
    'Restrict web management to the management VLAN, or turn off the web interface until you upgrade.';
  const a = await q(
    `INSERT INTO advisory (title, summary, severity, cvss_score, cvss_vector, body_md, body_html,
        workaround_md, workaround_html, status, revision, published_at, created_by)
     VALUES ($1, $2, 'low', 3.5, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:L/A:N', $3, $4, $5, $6,
        'published', 1, now() - interval '20 days', $7)
     RETURNING id`,
    [
      'Cross-site request forgery on CoreLink diagnostic pages (demo)',
      'Two diagnostic pages in the CoreLink web interface did not check the anti-forgery token. Fixed in CoreLink OS 7.1.075.',
      body,
      renderMarkdown(body),
      workaround,
      renderMarkdown(workaround),
      authorId,
    ],
  );
  await q(
    `INSERT INTO advisory_affected (advisory_id, product_id, affected_versions, fixed_version)
     SELECT $1, id, '7.1.000 to 7.1.070', '7.1.075' FROM product WHERE sku IN ('WD-SW5600-48P', 'WD-SW3100-24T')`,
    [a.rows[0].id],
  );
  await q(`INSERT INTO advisory_internal (advisory_id, notes) VALUES ($1, 'Demo data.')`, [
    a.rows[0].id,
  ]);
  return 1;
}
