/**
 * Authorization suite GENERATED from packages/rbac/rbac.matrix.yaml (ADR-011):
 * every endpoint × every role, against a resource inside that role's reach. Allowed roles must
 * succeed (2xx); every other role must get 403 or 404. Changing a role in the matrix changes the tests.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMatrix } from '@wd/rbac';
import type { RoleKey } from '@wd/contracts';
import { caseBody, createTestApp, ORG, SERIAL, USERS, type TestApp } from './helpers.js';

const m = loadMatrix();
const ROLE_USER: Record<RoleKey, string> = {
  customer_user: USERS.kaveriUser,
  customer_admin: USERS.kaveriAdmin,
  partner: USERS.partner,
  l1_engineer: USERS.l1,
  l2_engineer: USERS.l2,
  l3_engineer: USERS.l3,
  support_manager: USERS.manager,
  content_editor: USERS.content,
  rma_coordinator: USERS.rma,
  system_admin: USERS.sysadmin,
};
const roles = Object.keys(m.roles) as RoleKey[];

let t: TestApp;
let requesterIds: Record<string, string>;
beforeAll(async () => {
  t = await createTestApp({ rateLimitScale: 100 });
  requesterIds = {
    kaveri: (await (await t.as(USERS.kaveriUser)).get('/api/v1/me')).body.id,
    narmada: (await (await t.as(USERS.narmadaUser)).get('/api/v1/me')).body.id,
  };
});
afterAll(() => t.close());

/** A fresh case inside the role's reach (own case for customers, delegated org for partners). */
async function caseFor(role: RoleKey): Promise<string> {
  const owner =
    role === 'partner'
      ? USERS.narmadaUser
      : role === 'customer_admin'
        ? USERS.kaveriUser
        : role === 'customer_user'
          ? USERS.kaveriUser
          : USERS.kaveriAdmin;
  const serial = role === 'partner' ? SERIAL.narmadaPremium : SERIAL.kaveriPremium;
  const r = await (await t.as(owner)).post('/api/v1/cases', caseBody(serial));
  expect(r.status).toBe(201);
  return r.body.id;
}

function bodyFor(id: string, role: RoleKey): unknown {
  switch (id) {
    case 'case.create':
      if (m.roles[role].internal)
        return caseBody(SERIAL.kaveriPremium, {
          orgId: ORG.kaveri,
          requesterId: requesterIds.kaveri,
        });
      if (role === 'partner') return caseBody(SERIAL.narmadaPremium, { orgId: ORG.narmada });
      return caseBody(SERIAL.kaveriPremium);
    case 'case.reply':
      return { visibility: 'public', body: 'Any update?' };
    case 'case.note':
      return { visibility: 'internal', body: 'Internal triage note' };
    case 'case.escalate':
      return { justification: 'Business impact is growing, please escalate this case.' };
    case 'case.transition':
      return { to: 'triage' };
    default:
      return undefined;
  }
}

describe.each(m.endpoints)('$method $path', (ep) => {
  it.each(roles)('%s', async (role) => {
    const allowed = ep.allow === '*' || ep.allow.includes(role);
    let path = ep.path.replace(/#.*$/, '').replace(':sku', 'WD-RT8800');
    if (path.includes(':case')) path = path.replace(':case', await caseFor(role));
    const client = await t.as(ROLE_USER[role]);
    const res =
      ep.method === 'GET' ? await client.get(path) : await client.post(path, bodyFor(ep.id, role));
    if (allowed)
      expect(res.status, `${role} should be allowed: ${JSON.stringify(res.body)}`).toBeLessThan(
        300,
      );
    else expect([403, 404], `${role} should be denied but got ${res.status}`).toContain(res.status);
  });
});

describe('every external role is denied on a foreign tenant (generated)', () => {
  const tenantEndpoints = m.endpoints.filter((e) => e.tenant);
  const external = roles.filter((r) => !m.roles[r].internal);
  it.each(external.flatMap((r) => tenantEndpoints.map((e) => [r, e] as const)))(
    '%s → %o',
    async (role, ep) => {
      // A case in an org this role has no relationship with: Kaveri for partner, Narmada for Kaveri users.
      const foreignOwner = role === 'partner' ? USERS.kaveriUser : USERS.narmadaUser;
      const foreignSerial = role === 'partner' ? SERIAL.kaveriPremium : SERIAL.narmadaPremium;
      const c = (await (await t.as(foreignOwner)).post('/api/v1/cases', caseBody(foreignSerial)))
        .body.id as string;
      const path = ep.path.replace(/#.*$/, '').replace(':case', c);
      const client = await t.as(ROLE_USER[role]);
      const res =
        ep.method === 'GET'
          ? await client.get(path)
          : await client.post(path, bodyFor(ep.id, role));
      expect(res.status).toBe(404);
    },
  );
});
