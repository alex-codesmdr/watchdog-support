/**
 * Knowledge base: audience-based visibility, search quality (stemming, error codes, typos, facets),
 * the draft → review → publish workflow with immutable versions, drafting from a resolved case,
 * feedback, HTML safety, and acceptance criterion 5: search < 500 ms on 10,000 articles.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caseBody, createTestApp, SERIAL, USERS, type TestApp } from './helpers.js';

let t: TestApp;
const search = (q: string, as?: string) =>
  as
    ? t.as(as).then((c) => c.get(`/api/v1/kb/search?q=${encodeURIComponent(q)}`))
    : t.http.get(`/api/v1/kb/search?q=${encodeURIComponent(q)}`);
const slugs = (r: { body: { items: Array<{ slug: string }> } }) => r.body.items.map((i) => i.slug);

beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
});
afterAll(() => t.close());

describe('visibility by audience', () => {
  it.each([
    ['anonymous', undefined, { public: true, registered: false, partner: false, internal: false }],
    [
      'customer',
      USERS.kaveriUser,
      { public: true, registered: true, partner: false, internal: false },
    ],
    ['partner', USERS.partner, { public: true, registered: true, partner: true, internal: false }],
    ['engineer', USERS.l1, { public: true, registered: true, partner: true, internal: true }],
  ] as const)('%s', async (_n, who, expected) => {
    const probes = {
      public: 'collect-a-tech-support-bundle',
      registered: 'core-switch-reboots-watchdog-timeout',
      partner: 'partner-rma-checklist',
      internal: 'internal-psu-telemetry-defect-triage',
    };
    for (const [vis, slug] of Object.entries(probes)) {
      const r = who
        ? await (await t.as(who)).get(`/api/v1/kb/articles/${slug}`)
        : await t.http.get(`/api/v1/kb/articles/${slug}`);
      expect([vis, r.status]).toEqual([vis, expected[vis as keyof typeof expected] ? 200 : 404]);
    }
    const all = who
      ? await (await t.as(who)).get('/api/v1/kb/search?limit=50')
      : await t.http.get('/api/v1/kb/search?limit=50');
    expect(slugs(all).includes(probes.internal)).toBe(expected.internal);
    expect(slugs(all).includes(probes.registered)).toBe(expected.registered);
  });
});

describe('search quality', () => {
  it('ranks by relevance with stemming ("rebooting" finds "reboots")', async () => {
    const r = await search('switch rebooting watchdog', USERS.kaveriUser);
    expect(r.status).toBe(200);
    expect(slugs(r)[0]).toBe('core-switch-reboots-watchdog-timeout');
    expect(r.body.items[0].snippet).toMatch(/<mark>/);
  });

  it('finds device error codes and model numbers verbatim', async () => {
    expect(slugs(await search('%DEV/1/REBOOT', USERS.kaveriUser))).toContain(
      'core-switch-reboots-watchdog-timeout',
    );
    expect(slugs(await search('FW3100'))).toEqual(
      expect.arrayContaining(['configure-ipsec-site-to-site-vpn']),
    );
  });

  it('tolerates typos', async () => {
    expect(slugs(await search('upgrde firmwre'))).toContain('upgrade-wos-switch-firmware');
    expect(slugs(await search('ipsec propsal choosen'))).toContain('ipsec-no-proposal-chosen');
  });

  it('returns facets and filters by type and family', async () => {
    const all = await search('');
    expect(all.body.facets.type.troubleshooting).toBeGreaterThanOrEqual(2);
    expect(all.body.facets.family.security).toBe(2);
    const f = await t.http.get('/api/v1/kb/search?type=config_guide').expect(200);
    expect(f.body.items.every((i: { type: string }) => i.type === 'config_guide')).toBe(true);
    const fam = await t.http.get('/api/v1/kb/search?family=wireless').expect(200);
    expect(slugs(fam)).toEqual(['ap720-dfs-radar-channel-change']);
  });

  it('suggests a close title when nothing matches', async () => {
    const r = await search('raid rebuld replacment', USERS.kaveriUser);
    expect(r.body.total === 0 ? r.body.didYouMean : 'matched').toBeTruthy();
  });

  it('suggest endpoint powers case deflection', async () => {
    const r = await (
      await t.as(USERS.kaveriUser)
    )
      .get('/api/v1/kb/suggest?q=bgp%20neighbour%20down')
      .expect(200);
    expect(r.body.items[0].slug).toBe('bgp-neighbour-flaps-after-upgrade');
  });

  it('never leaks HTML from content into snippets', async () => {
    const r = await search('<script>alert(1)</script> bundle');
    expect(JSON.stringify(r.body)).not.toContain('<script>');
  });
});

describe('authoring workflow', () => {
  let id = '';
  const draft = {
    title: 'Reset a Sentinel FW3100 to factory defaults',
    summary: 'Use the console to restore factory settings when the admin password is lost.',
    bodyMd:
      '## Steps\n\n1. Connect the console cable.\n2. Press **Ctrl+B** during boot.\n\n<script>alert(1)</script><img src=x onerror=alert(1)>',
    type: 'howto',
    visibility: 'public',
    familyKey: 'security',
    productSkus: ['WD-FW3100'],
    firmwareVersions: ['WOS-SEC 5.4.2'],
  };

  it('engineers draft and submit; only editors publish', async () => {
    const l1 = await t.as(USERS.l1);
    const c = await l1.post('/api/v1/kb/editor/articles', draft).expect(201);
    id = c.body.id;
    expect(c.body).toMatchObject({
      slug: 'reset-a-sentinel-fw3100-to-factory-defaults',
      state: 'draft',
      currentVersion: 1,
    });
    expect(c.body.previewHtml).not.toMatch(/<script|onerror|<img/);
    await l1.post(`/api/v1/kb/editor/articles/${id}/submit`).expect(200);
    await l1.post(`/api/v1/kb/editor/articles/${id}/publish`).expect(403);
    await (await t.as(USERS.kaveriAdmin)).post('/api/v1/kb/editor/articles', draft).expect(403);
    expect(slugs(await search('factory defaults'))).not.toContain(c.body.slug);
    const p = await (
      await t.as(USERS.content)
    )
      .post(`/api/v1/kb/editor/articles/${id}/publish`)
      .expect(200);
    expect(p.body).toMatchObject({ state: 'published', publishedVersion: 1 });
    expect(slugs(await search('factory defaults'))[0]).toBe(c.body.slug);
  });

  it('editing creates a new version; readers keep seeing the published one until republish', async () => {
    const editor = await t.as(USERS.content);
    const u = await editor
      .put(`/api/v1/kb/editor/articles/${id}`, {
        ...draft,
        title: 'Reset a Sentinel FW3100 firewall to factory defaults',
        changeNote: 'Clarify title',
      })
      .expect(200);
    expect(u.body).toMatchObject({ currentVersion: 2, publishedVersion: 1, state: 'draft' });
    const live = await t.http
      .get('/api/v1/kb/articles/reset-a-sentinel-fw3100-to-factory-defaults')
      .expect(200);
    expect(live.body).toMatchObject({ title: draft.title, version: 1 });
    expect(live.body.bodyHtml).not.toMatch(/<script|onerror|<img/);
    await editor.post(`/api/v1/kb/editor/articles/${id}/publish`).expect(200);
    const v2 = await t.http
      .get('/api/v1/kb/articles/reset-a-sentinel-fw3100-to-factory-defaults')
      .expect(200);
    expect(v2.body).toMatchObject({
      title: 'Reset a Sentinel FW3100 firewall to factory defaults',
      version: 2,
    });
    expect(v2.body.products).toEqual([{ sku: 'WD-FW3100', modelName: 'WatchDog Sentinel FW3100' }]);
  });

  it('feedback is counted', async () => {
    await t.http
      .post('/api/v1/kb/articles/reset-a-sentinel-fw3100-to-factory-defaults/feedback')
      .send({ helpful: true })
      .expect(204);
    await t.http
      .post('/api/v1/kb/articles/reset-a-sentinel-fw3100-to-factory-defaults/feedback')
      .send({ helpful: false, comment: 'Needs a photo' })
      .expect(204);
    const r = await t.http
      .get('/api/v1/kb/articles/reset-a-sentinel-fw3100-to-factory-defaults')
      .expect(200);
    expect([r.body.helpful, r.body.notHelpful]).toEqual([1, 1]);
  });

  it('archiving removes the article from readers and search', async () => {
    await (await t.as(USERS.content)).post(`/api/v1/kb/editor/articles/${id}/archive`).expect(200);
    await t.http.get('/api/v1/kb/articles/reset-a-sentinel-fw3100-to-factory-defaults').expect(404);
    expect(slugs(await search('factory defaults'))).not.toContain(
      'reset-a-sentinel-fw3100-to-factory-defaults',
    );
  });

  it('drafts an internal article from a resolved case', async () => {
    const c = await (
      await t.as(USERS.kaveriUser)
    )
      .post('/api/v1/cases', caseBody(SERIAL.kaveriPremium))
      .expect(201);
    const l2 = await t.as(USERS.l2);
    await l2.post(`/api/v1/kb/editor/from-case/${c.body.number}`).expect(409);
    await l2
      .post(`/api/v1/cases/${c.body.id}/messages`, { body: 'Set BFD to 300 ms x 3 on both peers.' })
      .expect(201);
    await l2.post(`/api/v1/cases/${c.body.id}/transition`, { to: 'resolved' }).expect(200);
    const d = await l2.post(`/api/v1/kb/editor/from-case/${c.body.number}`).expect(201);
    expect(d.body).toMatchObject({
      visibility: 'internal',
      state: 'draft',
      sourceCaseNumber: c.body.number,
      familyKey: 'security',
    });
    expect(d.body.bodyMd).toMatch(/## Symptoms[\s\S]*## Resolution[\s\S]*BFD to 300 ms/);
    await (
      await t.as(USERS.kaveriAdmin)
    )
      .post(`/api/v1/kb/editor/from-case/${c.body.number}`)
      .expect(403);
  });
});

describe('performance: 10,000 articles (acceptance criterion 5)', () => {
  const QUERIES = [
    'switch reboot',
    'bgp hold timer',
    'ipsec proposal',
    'poe budget',
    'firmware upgrade',
    'radar channel',
    'raid rebuild',
    'snmp v3',
    'vpn tunnel down',
    'interface errors crc',
    'upgrde firmwre',
    'dhcp relay',
    'vlan trunk',
    'ospf adjacency',
    'license activation',
    'high cpu',
    'memory leak',
    'fan failure',
    'ntp sync',
    'ssh access',
  ];

  beforeAll(async () => {
    // 10,000 synthetic published articles built from a networking vocabulary, plus the real ones.
    await t.owner.query(`
      WITH words AS (SELECT ARRAY['switch','router','firewall','vlan','trunk','bgp','ospf','ipsec','tunnel','poe','radio','channel','raid','disk','fan','cpu','memory','license','ntp','ssh','dhcp','relay','crc','errors','interface','upgrade','firmware','reboot','timeout','latency','packet','loss','qos','acl','nat','snmp','syslog','stack','member','uplink'] AS w),
      gen AS (
        SELECT g, (SELECT string_agg(w[1 + ((g::bigint * k * 7919) % array_length(w,1))::int], ' ') FROM generate_series(1, 6) k) AS title_words,
               (SELECT string_agg(w[1 + ((g::bigint * k * 104729) % array_length(w,1))::int], ' ') FROM generate_series(1, 120) k) AS body_words
        FROM words, generate_series(1, 10000) g)
      INSERT INTO kb_article (slug, type, visibility, state, current_version, published_version, title, summary, search_vec, created_by, published_at)
      SELECT 'perf-' || g,
             (ARRAY['howto','troubleshooting','config_guide','faq','known_issue','best_practice'])[1 + g % 6],
             (ARRAY['public','public','registered','internal'])[1 + g % 4],
             'published', 1, 1,
             initcap(title_words) || ' ' || g,
             'Summary of ' || title_words,
             wd.kb_document(initcap(title_words), 'Summary of ' || title_words, body_words, '{}'),
             '00000000-0000-4000-8000-000000000001', now() - (g || ' minutes')::interval
      FROM gen`);
    await t.owner.query('ANALYZE kb_article');
  }, 120_000);

  it('p95 search latency is under 500 ms for anonymous and staff audiences', async () => {
    const times: number[] = [];
    for (const who of [undefined, USERS.kaveriUser, USERS.l1]) {
      for (const q of QUERIES) {
        const started = performance.now();
        const r = await search(q, who);
        expect(r.status).toBe(200);
        times.push(performance.now() - started);
      }
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    console.log(
      `KB search over ${10_000 + 14} articles: p50 ${times[Math.floor(times.length / 2)]!.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, max ${times[times.length - 1]!.toFixed(0)} ms (${times.length} queries)`,
    );
    expect(p95).toBeLessThan(500);
  }, 120_000);

  it('still returns relevant hits and accurate totals at scale', async () => {
    const broad = await search('bgp');
    expect(broad.body.total).toBeGreaterThan(100);
    // the specific real article still ranks first among thousands of generic matches
    expect(slugs(await search('bgp neighbour flaps after upgrade'))[0]).toBe(
      'bgp-neighbour-flaps-after-upgrade',
    );
  });
});
