/**
 * Seeds reference data (roles/permissions from the RBAC matrix, catalog, calendars, SLA policies,
 * queues) and fictitious WatchDog demo tenants. Every product and organisation here is invented.
 *
 *   tsx db/seed.ts            reference data + demo data (demo only if no customer org exists)
 *   tsx db/seed.ts --reset    wipe tenant data first (never run against production)
 */
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadMatrix } from '@wd/rbac';

export const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
export const INTERNAL_ORG_ID = '00000000-0000-4000-8000-000000000100';

const FAMILIES = [
  ['sd-wan', 'SD-WAN', 'Branch and data-centre edge routers with centralised orchestration.'],
  ['switching', 'Switching', 'Access, aggregation and core Ethernet switches.'],
  ['routing', 'Routing', 'Service-provider and enterprise routers.'],
  ['security', 'Security', 'Next-generation firewalls and VPN gateways.'],
  ['wireless', 'Wireless', 'Wi-Fi 6/6E/7 access points and controllers.'],
  ['servers-storage', 'Servers & Storage', 'Rack servers and unified storage arrays.'],
  ['management', 'Management', 'Network management and monitoring software.'],
] as const;

// [family, sku, model, lifecycle, opaque internal ref (never customer-visible)]
const PRODUCTS = [
  ['sd-wan', 'WD-SDW-1200', 'WatchDog EdgeGuard SDW-1200', 'ga', 'OEM-REF-1001'],
  ['sd-wan', 'WD-SDW-3400', 'WatchDog EdgeGuard SDW-3400', 'ga', 'OEM-REF-1002'],
  ['switching', 'WD-SW5600-48P', 'WatchDog CoreLink SW5600-48P', 'ga', 'OEM-REF-2001'],
  ['switching', 'WD-SW3100-24T', 'WatchDog CoreLink SW3100-24T', 'eos_announced', 'OEM-REF-2002'],
  ['routing', 'WD-RT8800', 'WatchDog PathMaster RT8800', 'ga', 'OEM-REF-3001'],
  ['security', 'WD-FW3100', 'WatchDog Sentinel FW3100', 'ga', 'OEM-REF-4001'],
  ['wireless', 'WD-AP720', 'WatchDog AirPack AP720 (Wi-Fi 6E)', 'ga', 'OEM-REF-5001'],
  ['servers-storage', 'WD-SRV-2200', 'WatchDog Compute SRV-2200', 'ga', 'OEM-REF-6001'],
  ['management', 'WD-NMS-ENT', 'WatchDog Insight NMS Enterprise', 'ga', 'OEM-REF-7001'],
] as const;

// DoP&T O.M. 03.07.2025, Annexure-I (closed holidays, Delhi/New Delhi, 2026).
// 2027: only fixed-date national holidays until the 2027 list is published — load it via admin then.
const HOLIDAYS: Array<[string, string]> = [
  ['2026-01-26', 'Republic Day'],
  ['2026-03-04', 'Holi'],
  ['2026-03-21', 'Id-ul-Fitr'],
  ['2026-03-26', 'Ram Navami'],
  ['2026-03-31', 'Mahavir Jayanti'],
  ['2026-04-03', 'Good Friday'],
  ['2026-05-01', 'Buddha Purnima'],
  ['2026-05-27', 'Id-ul-Zuha (Bakrid)'],
  ['2026-06-26', 'Muharram'],
  ['2026-08-15', 'Independence Day'],
  ['2026-08-26', 'Milad-un-Nabi'],
  ['2026-09-04', 'Janmashtami'],
  ['2026-10-02', "Mahatma Gandhi's Birthday"],
  ['2026-10-20', 'Dussehra'],
  ['2026-11-08', 'Diwali'],
  ['2026-11-24', "Guru Nanak's Birthday"],
  ['2026-12-25', 'Christmas Day'],
  ['2027-01-26', 'Republic Day'],
  ['2027-08-15', 'Independence Day'],
  ['2027-10-02', "Mahatma Gandhi's Birthday"],
  ['2027-12-25', 'Christmas Day'],
];

const BUSINESS_WEEK = {
  mon: [['09:00', '18:00']],
  tue: [['09:00', '18:00']],
  wed: [['09:00', '18:00']],
  thu: [['09:00', '18:00']],
  fri: [['09:00', '18:00']],
  sat: [['09:00', '13:00']],
};

const H = 60;
const BD = 9 * 60; // one business day = 9 business hours
// tier -> severity -> [first_response, update_every, restoration|null, resolution, 24x7]
const SLA: Record<string, Record<string, [number, number, number | null, number, boolean]>> = {
  mission_critical: {
    P1: [15, 60, 4 * H, 24 * H, true],
    P2: [30, 4 * H, 8 * H, 72 * H, true],
    P3: [4 * H, 2 * BD, null, 15 * BD, false],
    P4: [BD, 5 * BD, null, 30 * BD, false],
  },
  premium: {
    P1: [30, 2 * H, 8 * H, 48 * H, true],
    P2: [H, 8 * H, BD, 5 * BD, false],
    P3: [4 * H, 2 * BD, null, 15 * BD, false],
    P4: [BD, 5 * BD, null, 30 * BD, false],
  },
  standard: {
    P1: [2 * H, BD, 2 * BD, 10 * BD, false],
    P2: [4 * H, BD, 3 * BD, 10 * BD, false],
    P3: [4 * H, 2 * BD, null, 15 * BD, false],
    P4: [BD, 5 * BD, null, 30 * BD, false],
  },
};

const ORGS = {
  internal: INTERNAL_ORG_ID,
  kaveri: '00000000-0000-4000-8000-000000000201',
  narmada: '00000000-0000-4000-8000-000000000202',
  sahyadri: '00000000-0000-4000-8000-000000000301',
};

// [id, org, email, name, roles]
export const DEMO_USERS: Array<[string, string, string, string, string[]]> = [
  [SYSTEM_USER_ID, ORGS.internal, 'system@watchdog.example', 'WatchDog System', []],
  [
    '00000000-0000-4000-8000-000000001001',
    ORGS.internal,
    'asha.l1@watchdog.example',
    'Asha Menon',
    ['l1_engineer'],
  ],
  [
    '00000000-0000-4000-8000-000000001002',
    ORGS.internal,
    'vikram.l2@watchdog.example',
    'Vikram Rao',
    ['l2_engineer'],
  ],
  [
    '00000000-0000-4000-8000-000000001003',
    ORGS.internal,
    'farah.l3@watchdog.example',
    'Farah Qureshi',
    ['l3_engineer'],
  ],
  [
    '00000000-0000-4000-8000-000000001004',
    ORGS.internal,
    'rohan.manager@watchdog.example',
    'Rohan Iyer',
    ['support_manager'],
  ],
  [
    '00000000-0000-4000-8000-000000001005',
    ORGS.internal,
    'meera.content@watchdog.example',
    'Meera Pillai',
    ['content_editor'],
  ],
  [
    '00000000-0000-4000-8000-000000001006',
    ORGS.internal,
    'arjun.rma@watchdog.example',
    'Arjun Das',
    ['rma_coordinator'],
  ],
  [
    '00000000-0000-4000-8000-000000001007',
    ORGS.internal,
    'neha.admin@watchdog.example',
    'Neha Kulkarni',
    ['system_admin'],
  ],
  [
    '00000000-0000-4000-8000-000000002001',
    ORGS.kaveri,
    'it.admin@kaveribank.example',
    'Suresh Gowda',
    ['customer_admin'],
  ],
  [
    '00000000-0000-4000-8000-000000002002',
    ORGS.kaveri,
    'noc@kaveribank.example',
    'Lakshmi Nair',
    ['customer_user'],
  ],
  [
    '00000000-0000-4000-8000-000000002101',
    ORGS.narmada,
    'admin@narmadacity.example',
    'Imran Shaikh',
    ['customer_admin'],
  ],
  [
    '00000000-0000-4000-8000-000000002102',
    ORGS.narmada,
    'netops@narmadacity.example',
    'Kavya Patel',
    ['customer_user'],
  ],
  [
    '00000000-0000-4000-8000-000000003001',
    ORGS.sahyadri,
    'support@sahyadri-si.example',
    'Nikhil Joshi',
    ['partner'],
  ],
];

export async function seed(url: string, opts: { reset?: boolean; log?: (s: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const q = (text: string, values: unknown[] = []) => c.query(text, values);
  try {
    await q('BEGIN');
    if (opts.reset) {
      await q(`TRUNCATE notification, csat_response, sla_clock, case_event, case_attachment, upload, case_message,
               support_case, inbound_email_hold, entitlement, asset, site, partner_delegation, registration,
               consent_record, user_role, org_domain, outbox_event, app_user, organization CASCADE`);
      log('  reset tenant data');
    }

    // RBAC from the matrix (source of truth)
    const m = loadMatrix();
    for (const p of m.permissions)
      await q('INSERT INTO permission (key) VALUES ($1) ON CONFLICT DO NOTHING', [p]);
    for (const [key, def] of Object.entries(m.roles)) {
      const name = key.replace(/_/g, ' ').replace(/\b\w/g, (s) => s.toUpperCase());
      await q(
        `INSERT INTO role (key, name, is_internal) VALUES ($1,$2,$3)
               ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, is_internal = EXCLUDED.is_internal`,
        [key, name, def.internal],
      );
      await q('DELETE FROM role_permission WHERE role_key = $1', [key]);
      for (const p of def.permissions)
        await q('INSERT INTO role_permission VALUES ($1,$2)', [key, p]);
    }

    // Catalog
    for (const [i, [key, name, desc]] of FAMILIES.entries())
      await q(
        `INSERT INTO product_family (key, name, description, sort_order) VALUES ($1,$2,$3,$4)
               ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
        [key, name, desc, i],
      );
    for (const [fam, sku, model, lc, ref] of PRODUCTS)
      await q(
        `INSERT INTO product (family_id, sku, model_name, lifecycle, internal_oem_ref, specs)
               SELECT id, $2, $3, $4, $5, '{}'::jsonb FROM product_family WHERE key = $1
               ON CONFLICT (sku) DO UPDATE SET model_name = EXCLUDED.model_name, lifecycle = EXCLUDED.lifecycle`,
        [fam, sku, model, lc, ref],
      );

    // Calendars & SLA
    const cal = await q(
      `INSERT INTO business_calendar (key, name, time_zone, weekly) VALUES ('ist-business', 'IST business hours (Mon–Fri 09–18, Sat 09–13)', 'Asia/Kolkata', $1)
                         ON CONFLICT (key) DO UPDATE SET weekly = EXCLUDED.weekly RETURNING id`,
      [JSON.stringify(BUSINESS_WEEK)],
    );
    await q(
      `INSERT INTO business_calendar (key, name, time_zone, twenty_four_seven) VALUES ('24x7', '24×7', 'Asia/Kolkata', true) ON CONFLICT (key) DO NOTHING`,
    );
    const calId = cal.rows[0].id as string;
    for (const [day, name] of HOLIDAYS)
      await q(
        'INSERT INTO calendar_holiday (calendar_id, day, name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [calId, day, name],
      );
    for (const [tier, targets] of Object.entries(SLA)) {
      const pol = await q(
        `INSERT INTO sla_policy (tier, version, calendar_id) VALUES ($1, 1, $2)
                           ON CONFLICT (tier, version) DO UPDATE SET calendar_id = EXCLUDED.calendar_id RETURNING id`,
        [tier, calId],
      );
      for (const [sev, [fr, upd, rest, res, rtc]] of Object.entries(targets))
        await q(
          `INSERT INTO sla_target VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT (policy_id, severity) DO UPDATE SET first_response_min = $3, update_every_min = $4,
                 restoration_min = $5, resolution_min = $6, round_the_clock = $7`,
          [pol.rows[0].id, sev, fr, upd, rest, res, rtc],
        );
    }
    for (const [key, name, lvl] of [
      ['l1', 'L1 – Frontline', 1],
      ['l2', 'L2 – Product specialists', 2],
      ['l3', 'L3 – Escalation engineering', 3],
      ['eng', 'Engineering', 4],
    ] as const)
      await q(
        'INSERT INTO queue (key, name, support_level) VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING',
        [key, name, lvl],
      );

    // Internal org + system user always exist
    await q(
      `INSERT INTO organization (id, name, org_type, status) VALUES ($1, 'WatchDog Support (Apollo Infoways Pvt. Ltd.)', 'internal', 'active') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [ORGS.internal],
    );
    await q(
      `INSERT INTO app_user (id, org_id, email, display_name, status, is_service) VALUES ($1,$2,'system@watchdog.example','WatchDog System','active',true) ON CONFLICT (id) DO NOTHING`,
      [SYSTEM_USER_ID, ORGS.internal],
    );

    // SLA escalation defaults (design §6.4) — only when no rules exist, so admin edits survive re-seeding.
    if (!(await q('SELECT 1 FROM escalation_rule LIMIT 1')).rowCount) {
      const rules: Array<[number, string, string | null]> = [
        [50, 'notify_assignee', null],
        [75, 'notify_assignee', null],
        [75, 'notify_managers', null],
        [90, 'notify_managers', null],
        [90, 'notify_matrix', null],
        [100, 'notify_managers', null],
        [100, 'notify_matrix', null],
        [100, 'escalate_level', 'first_response'],
        [100, 'escalate_level', 'restoration'],
        [100, 'escalate_level', 'resolution'],
      ];
      for (const [t, a, m] of rules)
        await q('INSERT INTO escalation_rule (threshold, action, metric) VALUES ($1,$2,$3)', [
          t,
          a,
          m,
        ]);
    }
    if (!(await q('SELECT 1 FROM escalation_contact LIMIT 1')).rowCount) {
      const contacts: Array<[string | null, number, string, string, string]> = [
        [
          null,
          1,
          'Duty Support Manager',
          'Duty Manager (24x7 rota)',
          'duty.manager@watchdog.example',
        ],
        [null, 2, 'Priya Raman', 'Head of Technical Support', 'head.support@watchdog.example'],
        [null, 3, 'Anil Mehta', 'VP Customer Success', 'vp.customer@watchdog.example'],
        [
          'mission_critical',
          1,
          'Mission-Critical Desk',
          'MC Duty Lead (24x7)',
          'mc.desk@watchdog.example',
        ],
      ];
      for (const [tier, level, name, title, email] of contacts)
        await q(
          'INSERT INTO escalation_contact (tier, level, name, title, email) VALUES ($1,$2,$3,$4,$5)',
          [tier, level, name, title, email],
        );
    }

    const hasDemo = (await q(`SELECT 1 FROM organization WHERE org_type <> 'internal' LIMIT 1`))
      .rowCount;
    if (!hasDemo) {
      await seedDemo(q);
      log('  demo tenants seeded');
    }
    await q('COMMIT');
    log('seed complete');
  } catch (e) {
    await q('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

async function seedDemo(q: (t: string, v?: unknown[]) => Promise<pg.QueryResult>) {
  await q(
    `INSERT INTO organization (id, name, org_type, status, gstin) VALUES
    ($1, 'Kaveri Cooperative Bank (Demo)', 'customer', 'active', '29ABCDE1234F1Z5'),
    ($2, 'Narmada Smart City Authority (Demo)', 'customer', 'active', NULL),
    ($3, 'Sahyadri Systems Integrators (Demo)', 'partner', 'active', '27PQRSX6789K1Z2')`,
    [ORGS.kaveri, ORGS.narmada, ORGS.sahyadri],
  );
  for (const [id, org, email, name, roles] of DEMO_USERS) {
    if (id === SYSTEM_USER_ID) continue;
    await q(
      `INSERT INTO app_user (id, org_id, email, display_name, status) VALUES ($1,$2,$3,$4,'invited')`,
      [id, org, email, name],
    );
    for (const r of roles)
      await q('INSERT INTO user_role (user_id, role_key) VALUES ($1,$2)', [id, r]);
  }
  await q(
    `INSERT INTO partner_delegation (partner_org_id, customer_org_id, scope) VALUES ($1, $2, '{cases,assets}')`,
    [ORGS.sahyadri, ORGS.narmada],
  );
  await q(
    `INSERT INTO org_domain (org_id, domain, verified_at) VALUES ($1,'kaveribank.example',now()), ($2,'narmadacity.example',now()), ($3,'sahyadri-si.example',now())`,
    [ORGS.kaveri, ORGS.narmada, ORGS.sahyadri],
  );

  const site = async (org: string, name: string, city: string, state: string, pin: string) =>
    (
      await q(
        `INSERT INTO site (org_id, name, city, state, pincode) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [org, name, city, state, pin],
      )
    ).rows[0].id as string;
  const kHq = await site(
    ORGS.kaveri,
    'Head Office – Bengaluru',
    'Bengaluru',
    'Karnataka',
    '560001',
  );
  const kDc = await site(ORGS.kaveri, 'Data Centre – Mysuru', 'Mysuru', 'Karnataka', '570001');
  const nCc = await site(
    ORGS.narmada,
    'Integrated Command Centre',
    'Jabalpur',
    'Madhya Pradesh',
    '482001',
  );

  const asset = async (
    org: string,
    siteId: string,
    sku: string,
    serial: string,
    ver: string,
    ents: Array<[string, string, string, string]>,
  ) => {
    const a = await q(
      `INSERT INTO asset (org_id, site_id, product_id, serial_number, current_version, purchase_date)
                       SELECT $1,$2,id,$4,$5, current_date - 400 FROM product WHERE sku = $3 RETURNING id`,
      [org, siteId, sku, serial, ver],
    );
    for (const [kind, tier, from, to] of ents)
      await q(
        `INSERT INTO entitlement (org_id, asset_id, kind, tier, starts_on, ends_on, contract_ref) VALUES ($1,$2,$3,$4,$5::date,$6::date,$7)`,
        [org, a.rows[0].id, kind, tier, from, to, `CTR-${serial.slice(-4)}`],
      );
  };
  const y = new Date().getUTCFullYear();
  await asset(ORGS.kaveri, kDc, 'WD-SW5600-48P', 'WDSW5600A0001', 'WOS 7.1.070', [
    ['amc', 'mission_critical', `${y - 1}-04-01`, `${y + 2}-03-31`],
  ]);
  await asset(ORGS.kaveri, kDc, 'WD-FW3100', 'WDFW3100B0002', 'WOS-SEC 5.4.2', [
    ['amc', 'premium', `${y - 1}-04-01`, `${y + 1}-03-31`],
  ]);
  await asset(ORGS.kaveri, kHq, 'WD-SDW-1200', 'WDSDW1200C0003', 'WOS-EDGE 3.2.1', [
    ['warranty', 'standard', `${y - 2}-01-01`, `${y}-12-31`],
  ]);
  await asset(ORGS.kaveri, kHq, 'WD-SW3100-24T', 'WDSW3100D0004', 'WOS 6.9.012', [
    ['warranty', 'standard', `${y - 4}-01-01`, `${y - 1}-01-01`],
  ]);
  await asset(ORGS.narmada, nCc, 'WD-RT8800', 'WDRT8800E0005', 'WOS 7.1.070', [
    ['amc', 'premium', `${y - 1}-06-01`, `${y + 1}-05-31`],
  ]);
  await asset(ORGS.narmada, nCc, 'WD-AP720', 'WDAP720F0006', 'WOS-AIR 2.0.5', [
    ['warranty', 'standard', `${y - 1}-06-01`, `${y + 2}-05-31`],
  ]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) {
    console.error('DATABASE_OWNER_URL is required');
    process.exit(1);
  }
  if (process.argv.includes('--reset') && process.env.NODE_ENV === 'production') {
    console.error('refusing --reset in production');
    process.exit(1);
  }
  seed(url, { reset: process.argv.includes('--reset') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
