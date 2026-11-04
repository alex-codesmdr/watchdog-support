import { describe, expect, it } from 'vitest';
import { asCase, buildAbility, loadMatrix, permissionsFor, validateMatrix } from './index.js';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const U1 = '00000000-0000-0000-0000-000000000001';
const U2 = '00000000-0000-0000-0000-000000000002';

describe('rbac matrix', () => {
  it('loads and validates', () => {
    const m = loadMatrix();
    expect(Object.keys(m.roles)).toHaveLength(10);
  });

  it('rejects an external role holding staff permissions', () => {
    const m = structuredClone(loadMatrix());
    m.roles.customer_user.permissions.push('case:note:internal');
    expect(() => validateMatrix(m)).toThrow(/staff-only/);
  });

  it('customer user reads only own cases', () => {
    const ab = buildAbility({ userId: U1, orgId: A, delegatedOrgIds: [], permissions: permissionsFor(['customer_user']) });
    expect(ab.can('read', asCase({ orgId: A, requesterId: U1 }))).toBe(true);
    expect(ab.can('read', asCase({ orgId: A, requesterId: U2 }))).toBe(false);
    expect(ab.can('note', asCase({ orgId: A, requesterId: U1 }))).toBe(false);
  });

  it('customer admin reads org cases but never another org', () => {
    const ab = buildAbility({ userId: U1, orgId: A, delegatedOrgIds: [], permissions: permissionsFor(['customer_admin']) });
    expect(ab.can('read', asCase({ orgId: A, requesterId: U2 }))).toBe(true);
    expect(ab.can('read', asCase({ orgId: B, requesterId: U2 }))).toBe(false);
  });

  it('partner reads delegated orgs only', () => {
    const ab = buildAbility({ userId: U1, orgId: A, delegatedOrgIds: [B], permissions: permissionsFor(['partner']) });
    expect(ab.can('read', asCase({ orgId: B, requesterId: U2 }))).toBe(true);
    expect(ab.can('read', asCase({ orgId: A, requesterId: U2 }))).toBe(false);
  });

  it('engineers can add internal notes on any case', () => {
    const ab = buildAbility({ userId: U1, orgId: A, delegatedOrgIds: [], permissions: permissionsFor(['l1_engineer']) });
    expect(ab.can('note', asCase({ orgId: B, requesterId: U2 }))).toBe(true);
    expect(ab.can('csat', asCase({ orgId: B, requesterId: U2 }))).toBe(false);
  });
});
