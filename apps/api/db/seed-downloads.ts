/**
 * Starter download-centre content: one licence agreement and a handful of fictitious WatchDog
 * releases. File bytes are generated deterministically so their SHA-256 is stable; `setup.ts`
 * writes them to object storage (tests upload their own files through the API instead).
 */
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { renderMarkdown } from '../src/modules/kb/markdown.js';

type Q = (t: string, v?: unknown[]) => Promise<pg.QueryResult>;

export const EULA_VERSION = '2026.1';
const EULA_HTML = renderMarkdown(`
This WatchDog Software Licence Agreement ("Agreement") is between **Apollo Infoways Pvt. Ltd.**
("WatchDog") and the organisation that downloads WatchDog software ("Licensee").

1. **Licence.** WatchDog grants Licensee a non-exclusive, non-transferable licence to install the
   software only on WatchDog devices that Licensee owns and that hold active WatchDog coverage.
2. **Restrictions.** Licensee will not copy, modify, reverse-engineer or redistribute the software,
   except as permitted by law.
3. **Export.** Licensee will comply with Indian and other applicable export-control laws.
4. **Warranty.** Software is provided under the terms of Licensee's WatchDog support contract.
5. **Governing law.** This Agreement is governed by the laws of India; courts at Bengaluru have
   jurisdiction.
`);

/** Deterministic pseudo-random bytes (stable checksum across environments). */
function bytes(seed: string, size: number): Buffer {
  const out = Buffer.alloc(size);
  let block = createHash('sha256').update(seed).digest();
  for (let o = 0; o < size; o += block.length) {
    block.copy(out, o);
    block = createHash('sha256').update(block).digest();
  }
  return out;
}
const text = (s: string) => Buffer.from(s.trim() + '\n', 'utf8');

interface SeedRelease {
  family: string;
  kind: 'firmware' | 'software' | 'release_notes' | 'mib' | 'document' | 'tool';
  title: string;
  version: string;
  visibility: 'public' | 'registered' | 'entitled' | 'internal';
  status: 'published' | 'deprecated';
  recommended: boolean;
  releasedOn: string;
  skus: string[];
  eula: boolean;
  notes: string;
  files: Array<{ name: string; content: () => Buffer }>;
}

export const SEED_RELEASES: SeedRelease[] = [
  {
    family: 'switching',
    kind: 'firmware',
    title: 'CoreLink OS',
    version: '7.1.075',
    visibility: 'entitled',
    status: 'published',
    recommended: true,
    releasedOn: '2026-10-12',
    skus: ['WD-SW5600-48P', 'WD-SW3100-24T'],
    eula: true,
    notes: `Recommended release for CoreLink switches.

### Fixed
- Unexpected reboot with a watchdog timeout when the ARP table exceeds 60,000 entries.
- SNMP walk of the interface table could time out on 48-port models.

### Upgrade
Upgrade from 7.1.060 or later directly. From older releases, upgrade to 7.1.060 first.
Verify the image checksum before installing: \`dir flash:/\` then compare the SHA-256 shown here.`,
    files: [
      { name: 'corelink-os-7.1.075.bin', content: () => bytes('corelink-os-7.1.075', 262_144) },
    ],
  },
  {
    family: 'switching',
    kind: 'firmware',
    title: 'CoreLink OS',
    version: '7.1.070',
    visibility: 'entitled',
    status: 'deprecated',
    recommended: false,
    releasedOn: '2026-07-02',
    skus: ['WD-SW5600-48P', 'WD-SW3100-24T'],
    eula: true,
    notes: 'Superseded by 7.1.075. Keep for rollback only.',
    files: [
      { name: 'corelink-os-7.1.070.bin', content: () => bytes('corelink-os-7.1.070', 262_144) },
    ],
  },
  {
    family: 'switching',
    kind: 'release_notes',
    title: 'CoreLink OS 7.1.075 release notes',
    version: '7.1.075',
    visibility: 'public',
    status: 'published',
    recommended: false,
    releasedOn: '2026-10-12',
    skus: [],
    eula: false,
    notes: 'What changed in CoreLink OS 7.1.075, known issues and upgrade paths.',
    files: [
      {
        name: 'corelink-os-7.1.075-release-notes.txt',
        content: () =>
          text(`
CoreLink OS 7.1.075 release notes
Released 12 Oct 2026

Fixed: watchdog-timeout reboot with very large ARP tables.
Fixed: SNMP ifTable walk timeouts on 48-port models.
Known issue: none.
Upgrade path: 7.1.060 or later directly.
`),
      },
    ],
  },
  {
    family: 'management',
    kind: 'mib',
    title: 'WatchDog enterprise MIBs',
    version: '2026.10',
    visibility: 'public',
    status: 'published',
    recommended: true,
    releasedOn: '2026-10-01',
    skus: [],
    eula: false,
    notes: 'SNMP MIB modules for every WatchDog product family. Load WATCHDOG-SMI first.',
    files: [
      {
        name: 'WATCHDOG-SMI.mib',
        content: () =>
          text(`
WATCHDOG-SMI DEFINITIONS ::= BEGIN
IMPORTS MODULE-IDENTITY, enterprises FROM SNMPv2-SMI;
watchdog MODULE-IDENTITY
    LAST-UPDATED "202610010000Z"
    ORGANIZATION "Apollo Infoways Pvt. Ltd. (WatchDog)"
    CONTACT-INFO "support@watchdog.example"
    DESCRIPTION  "Root of the WatchDog enterprise MIB tree."
    ::= { enterprises 99999 }
END
`),
      },
    ],
  },
  {
    family: 'security',
    kind: 'firmware',
    title: 'Sentinel OS',
    version: '5.4.2',
    visibility: 'entitled',
    status: 'published',
    recommended: true,
    releasedOn: '2026-09-18',
    skus: ['WD-FW3100'],
    eula: true,
    notes:
      'Recommended release for Sentinel firewalls. Includes the September threat-signature engine.',
    files: [{ name: 'sentinel-os-5.4.2.img', content: () => bytes('sentinel-os-5.4.2', 196_608) }],
  },
  {
    family: 'wireless',
    kind: 'firmware',
    title: 'AirPack firmware',
    version: '2.3.1',
    visibility: 'registered',
    status: 'published',
    recommended: true,
    releasedOn: '2026-08-20',
    skus: ['WD-AP720'],
    eula: true,
    notes: 'Wi-Fi 6E stability release for the AP720.',
    files: [{ name: 'airpack-2.3.1.bin', content: () => bytes('airpack-2.3.1', 131_072) }],
  },
  {
    family: 'management',
    kind: 'tool',
    title: 'Field diagnostic collector',
    version: '1.4.0',
    visibility: 'internal',
    status: 'published',
    recommended: false,
    releasedOn: '2026-06-30',
    skus: [],
    eula: false,
    notes: 'Engineer-only collector for on-site visits.',
    files: [
      { name: 'wd-collector-1.4.0.tar.gz', content: () => bytes('wd-collector-1.4.0', 65_536) },
    ],
  },
];

export const seedObjectKey = (file: string) => `releases/seed/${file}`;

/** Inserts the starter EULA and releases if the download centre is empty. Returns the count. */
export async function seedDownloads(q: Q, authorId: string): Promise<number> {
  await q(
    `INSERT INTO eula (version, title, body_html) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING`,
    [EULA_VERSION, 'WatchDog Software Licence Agreement', EULA_HTML],
  );
  if ((await q('SELECT 1 FROM software_release LIMIT 1')).rowCount) return 0;
  const eula = (await q('SELECT id FROM eula WHERE version = $1', [EULA_VERSION])).rows[0].id;
  for (const r of SEED_RELEASES) {
    const rel = await q(
      `INSERT INTO software_release (family_id, kind, title, version, visibility, status, recommended,
          released_on, notes_md, notes_html, eula_id, created_by, published_at)
       SELECT f.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now() FROM product_family f WHERE f.key = $1
       RETURNING id`,
      [
        r.family,
        r.kind,
        r.title,
        r.version,
        r.visibility,
        r.status,
        r.recommended,
        r.releasedOn,
        r.notes,
        renderMarkdown(r.notes),
        r.eula ? eula : null,
        authorId,
      ],
    );
    const id = rel.rows[0].id;
    for (const sku of r.skus)
      await q(
        `INSERT INTO release_product (release_id, product_id) SELECT $1, id FROM product WHERE sku = $2`,
        [id, sku],
      );
    for (const f of r.files) {
      const b = f.content();
      await q(
        `INSERT INTO release_file (release_id, file_name, size_bytes, sha256, object_key, scan_status)
         VALUES ($1, $2, $3, $4, $5, 'clean')`,
        [id, f.name, b.length, createHash('sha256').update(b).digest('hex'), seedObjectKey(f.name)],
      );
    }
  }
  return SEED_RELEASES.length;
}
