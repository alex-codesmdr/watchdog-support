/**
 * Starter knowledge-base content for demos and tests. Fictitious WatchDog products and WOS
 * (WatchDog Operating System) commands only. Real articles are authored in the editor.
 */
import type pg from 'pg';
import { renderMarkdown } from '../src/modules/kb/markdown.js';
import { htmlToText } from '../src/common/sanitize.js';

type Q = (t: string, v?: unknown[]) => Promise<pg.QueryResult>;
interface SeedArticle {
  slug: string;
  type: 'howto' | 'troubleshooting' | 'config_guide' | 'faq' | 'known_issue' | 'best_practice';
  visibility: 'public' | 'registered' | 'partner' | 'internal';
  family: string | null;
  skus: string[];
  fw: string[];
  title: string;
  summary: string;
  body: string;
}

export const KB_ARTICLES: SeedArticle[] = [
  {
    slug: 'collect-a-tech-support-bundle',
    type: 'howto',
    visibility: 'public',
    family: null,
    skus: [],
    fw: [],
    title: 'Collect a diagnostic bundle for a support case',
    summary:
      'Generate the WOS diagnostic bundle and attach it to your case so engineers can start immediately.',
    body: `Most cases are resolved faster when the first message includes a diagnostic bundle.

## Steps

1. Log in to the device CLI with an administrator account.
2. Run:

\`\`\`
display diagnostic-information > flash:/diag-$(date).txt
\`\`\`

3. Copy the file off the device with SCP or SFTP.
4. Attach it to your case. Passwords, SNMP communities and pre-shared keys in the file are masked automatically when you upload it.

## Large files

The portal accepts files up to 2 GB and resumes interrupted uploads, so slow links are fine.`,
  },
  {
    slug: 'core-switch-reboots-watchdog-timeout',
    type: 'known_issue',
    visibility: 'registered',
    family: 'switching',
    skus: ['WD-SW5600-48P'],
    fw: ['WOS 7.1.070'],
    title: 'SW5600 reboots with %DEV/1/REBOOT watchdog timeout',
    summary:
      'CoreLink SW5600 switches on WOS 7.1.070 may reboot every few hours when a PSU reports a transient fault. Fixed in 7.1.080.',
    body: `## Symptoms

- The switch restarts every 4 to 8 hours.
- The log shows \`%DEV/1/REBOOT: Board 1 restarted (watchdog timeout)\`.
- \`display power\` lists PSU 2 as **Fault** shortly before the restart.

## Cause

A PSU telemetry message is retried indefinitely on WOS 7.1.070, starving the watchdog process.

## Workaround

Remove and reseat PSU 2, or run on PSU 1 only until you can upgrade.

## Fix

Upgrade to **WOS 7.1.080** or later.`,
  },
  {
    slug: 'bgp-neighbour-flaps-after-upgrade',
    type: 'troubleshooting',
    visibility: 'public',
    family: 'routing',
    skus: ['WD-RT8800'],
    fw: ['WOS 7.1.070'],
    title: 'BGP neighbour flaps after a software upgrade',
    summary:
      'Check hold timers, MTU and BFD settings when BGP sessions drop with "hold timer expired" after an upgrade.',
    body: `## Check the reason the session dropped

\`\`\`
display bgp peer ipv4 verbose
\`\`\`

Look for **Last error: hold timer expired**.

## Common causes

| Cause | Check | Fix |
|---|---|---|
| MTU mismatch | \`ping -f -s 1472\` to the neighbour | Align interface MTU on both sides |
| BFD timers too aggressive | \`display bfd session\` | Raise to 300 ms × 3 |
| Policy rejects keepalives | \`display acl all\` | Permit TCP 179 both directions |

If sessions still flap, open a case and attach the diagnostic bundle.`,
  },
  {
    slug: 'configure-ipsec-site-to-site-vpn',
    type: 'config_guide',
    visibility: 'public',
    family: 'security',
    skus: ['WD-FW3100'],
    fw: ['WOS-SEC 5.4.2'],
    title: 'Configure a site-to-site IPsec VPN on Sentinel FW3100',
    summary:
      'Step-by-step IKEv2 site-to-site VPN between two Sentinel firewalls, with verification commands.',
    body: `## Before you start

You need the public IP of each site and a shared secret, or certificates.

## Configuration

\`\`\`
ike proposal 10
 encryption-algorithm aes-gcm-256
 dh group20
ike profile BRANCH-1
 match remote identity address 203.0.113.20
 pre-shared-key <your-secret>
ipsec policy BRANCH-1 10 isakmp
 remote-address 203.0.113.20
 ike-profile BRANCH-1
\`\`\`

## Verify

\`\`\`
display ike sa
display ipsec sa brief
\`\`\`

If negotiation fails with **no proposal chosen**, the encryption or DH group differs between the two sites.`,
  },
  {
    slug: 'ipsec-no-proposal-chosen',
    type: 'troubleshooting',
    visibility: 'public',
    family: 'security',
    skus: ['WD-FW3100'],
    fw: [],
    title: 'IPsec SA negotiation failed: no proposal chosen',
    summary:
      'The two peers have no common encryption, integrity or DH group setting. Compare the IKE and IPsec proposals.',
    body: `This message means phase 1 or phase 2 could not agree on algorithms.

1. Run \`display ike proposal\` on both peers and compare encryption, integrity and DH group.
2. Run \`display ipsec transform-set\` and compare.
3. Make one side match the other, then clear the SA with \`reset ike sa\`.`,
  },
  {
    slug: 'poe-budget-exceeded',
    type: 'troubleshooting',
    visibility: 'public',
    family: 'switching',
    skus: ['WD-SW5600-48P', 'WD-SW3100-24T'],
    fw: [],
    title: 'PoE budget exceeded: ports stop powering devices',
    summary:
      'When total PoE demand exceeds the PSU budget, low-priority ports lose power. Set port priorities or add a PSU.',
    body: `## Check the budget

\`\`\`
display poe device
display poe interface
\`\`\`

## Fix

- Set **critical** priority on ports with access points and cameras: \`poe priority critical\`.
- Limit per-port power with \`poe max-power 15400\` where devices need less.
- Install a second PSU to raise the budget.`,
  },
  {
    slug: 'ap720-dfs-radar-channel-change',
    type: 'faq',
    visibility: 'public',
    family: 'wireless',
    skus: ['WD-AP720'],
    fw: ['WOS-AIR 2.0.5'],
    title: 'Why does the AP720 change channel after "DFS radar detected"?',
    summary:
      'Regulations require leaving a DFS channel when radar is detected. The AP moves to a non-DFS channel for 30 minutes.',
    body: `Channels 52–144 in the 5 GHz band are shared with radar systems. When an AirPack AP720 detects radar on such a channel, Indian and international rules require it to stop transmitting on it.

The AP moves to a non-DFS channel (36–48 or 149–165) and does not return for at least 30 minutes.

**To avoid this**, exclude DFS channels in the RF profile if your site is near an airport or weather radar.`,
  },
  {
    slug: 'sdwan-edge-zero-touch-provisioning',
    type: 'howto',
    visibility: 'registered',
    family: 'sd-wan',
    skus: ['WD-SDW-1200', 'WD-SDW-3400'],
    fw: ['WOS-EDGE 3.2.1'],
    title: 'Zero-touch provisioning for EdgeGuard SD-WAN branches',
    summary:
      'Register the serial number, assign a template, and the edge device configures itself when it reaches the internet.',
    body: `1. In Insight NMS, go to **Devices → Add device** and enter the serial number.
2. Assign the branch template and site.
3. Ship the device. On first boot it obtains an address by DHCP and contacts the orchestrator.
4. The status changes to **Online** within about 5 minutes.

If the device stays **Pending**, check that outbound TCP 443 to the orchestrator is allowed at the branch.`,
  },
  {
    slug: 'upgrade-wos-switch-firmware',
    type: 'howto',
    visibility: 'public',
    family: 'switching',
    skus: ['WD-SW5600-48P', 'WD-SW3100-24T'],
    fw: [],
    title: 'Upgrade WOS firmware on a CoreLink switch',
    summary:
      'Back up the configuration, verify the image checksum, install, and confirm the boot image before reloading.',
    body: `## Before you upgrade

- Read the release notes for the target version.
- Back up the configuration: \`save backup.cfg\`.
- Verify the SHA-256 of the image against the value on the download page.

## Install

\`\`\`
boot-loader file flash:/wos-7.1.080.bin all main
display boot-loader
reboot
\`\`\`

## After the reload

Run \`display version\` and confirm the new version on every member.`,
  },
  {
    slug: 'snmp-v3-monitoring-best-practice',
    type: 'best_practice',
    visibility: 'public',
    family: 'management',
    skus: ['WD-NMS-ENT'],
    fw: [],
    title: 'Use SNMPv3 for monitoring WatchDog devices',
    summary:
      'Replace SNMPv1/v2c communities with SNMPv3 users using SHA authentication and AES privacy.',
    body: `SNMP communities are sent in clear text. Use SNMPv3 with authentication and encryption:

\`\`\`
snmp-agent sys-info version v3
snmp-agent group v3 MONITOR privacy
snmp-agent usm-user v3 nms-reader MONITOR authentication-mode sha <auth-key> privacy-mode aes128 <priv-key>
\`\`\`

Restrict SNMP to your management subnet with an ACL, and rotate keys at least yearly.`,
  },
  {
    slug: 'srv-2200-raid-rebuild',
    type: 'howto',
    visibility: 'registered',
    family: 'servers-storage',
    skus: ['WD-SRV-2200'],
    fw: [],
    title: 'Replace a failed disk and rebuild RAID on Compute SRV-2200',
    summary:
      'Identify the failed drive by its LED, hot-swap it, and monitor the rebuild from the management controller.',
    body: `1. In the management controller, open **Storage → Physical drives** and note the slot showing **Failed**.
2. The slot LED blinks amber. Press the release button and remove the drive.
3. Insert the replacement of the same size or larger.
4. The rebuild starts automatically. Progress is shown under **Virtual drives**.

Do not remove a second drive until the rebuild completes. If the replacement is not detected, open an RMA case.`,
  },
  {
    slug: 'partner-rma-checklist',
    type: 'best_practice',
    visibility: 'partner',
    family: null,
    skus: [],
    fw: [],
    title: 'Partner checklist before requesting an RMA',
    summary:
      'What partners should collect before raising an RMA for a customer device: serial, failure evidence, shipping and GST details.',
    body: `- Confirm the device serial and active coverage with the warranty check.
- Attach a diagnostic bundle and a photo of fault LEDs.
- Record the customer site address and GSTIN for the delivery challan.
- Confirm a contact who can receive the advance replacement.`,
  },
  {
    slug: 'internal-psu-telemetry-defect-triage',
    type: 'known_issue',
    visibility: 'internal',
    family: 'switching',
    skus: ['WD-SW5600-48P'],
    fw: ['WOS 7.1.070'],
    title: 'Internal: triage notes for PSU telemetry watchdog defect',
    summary:
      'Engineering defect DEF-4411. How to confirm from logs, and when to offer the hot-patch instead of an upgrade.',
    body: `Confirm with \`display logbuffer | include PSU\`: repeated **PSU2 telemetry retry** lines within 10 minutes before the reboot.

Offer hot-patch **HP-7.1.070-03** to customers who cannot schedule an upgrade window this week. Escalate to L3 if reboots continue after the patch.`,
  },
  {
    slug: 'portal-mfa-setup',
    type: 'faq',
    visibility: 'public',
    family: null,
    skus: [],
    fw: [],
    title: 'How do I set up two-step sign-in for the support portal?',
    summary:
      'Every account uses a password plus a 6-digit code from an authenticator app. You enrol the app the first time you sign in.',
    body: `The first time you sign in, the portal shows a QR code. Scan it with an authenticator app such as Microsoft Authenticator or Google Authenticator, then enter the 6-digit code it shows.

After that, every sign-in asks for your password and the current code.

**Lost your phone?** Ask your organisation's administrator, or contact WatchDog support, to reset your authenticator.`,
  },
];

/** Inserts and publishes the starter articles if the knowledge base is empty. */
export async function seedKb(q: Q, authorId: string): Promise<number> {
  if ((await q('SELECT 1 FROM kb_article LIMIT 1')).rowCount) return 0;
  for (const a of KB_ARTICLES) {
    const fam = a.family
      ? (await q('SELECT id FROM product_family WHERE key = $1', [a.family])).rows[0]?.id
      : null;
    const plain = htmlToText(renderMarkdown(a.body));
    const r = await q(
      `INSERT INTO kb_article (slug, type, visibility, state, family_id, current_version, published_version, title, summary,
         search_vec, firmware_versions, created_by, published_at)
       VALUES ($1,$2,$3,'published',$4,1,1,$5,$6, wd.kb_document($5,$6,$7,$8::text[]), $8::text[], $9, now() - (random() * interval '120 days'))
       RETURNING id`,
      [a.slug, a.type, a.visibility, fam, a.title, a.summary, plain, a.fw, authorId],
    );
    const id = r.rows[0].id as string;
    await q(
      'INSERT INTO kb_version (article_id, version, title, summary, body_md, author_id, reviewer_id, change_note) VALUES ($1,1,$2,$3,$4,$5,$5,$6)',
      [id, a.title, a.summary, a.body, authorId, 'Initial version'],
    );
    for (const sku of a.skus)
      await q('INSERT INTO kb_article_product SELECT $1, id FROM product WHERE sku = $2', [
        id,
        sku,
      ]);
  }
  return KB_ARTICLES.length;
}
