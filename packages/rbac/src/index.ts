import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';
import { parse } from 'yaml';
import type { RoleKey } from '@wd/contracts';

export interface RoleDef {
  internal: boolean;
  permissions: string[];
}
export interface EndpointExpectation {
  id: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  allow: RoleKey[] | '*';
  tenant?: boolean;
}
export interface RbacMatrix {
  version: number;
  permissions: string[];
  roles: Record<RoleKey, RoleDef>;
  endpoints: EndpointExpectation[];
}

export const MATRIX_PATH = fileURLToPath(new URL('../rbac.matrix.yaml', import.meta.url));

let cached: RbacMatrix | undefined;
export function loadMatrix(path = MATRIX_PATH): RbacMatrix {
  if (cached && path === MATRIX_PATH) return cached;
  const m = parse(readFileSync(path, 'utf8')) as RbacMatrix;
  validateMatrix(m);
  if (path === MATRIX_PATH) cached = m;
  return m;
}

export function validateMatrix(m: RbacMatrix): void {
  const known = new Set(m.permissions);
  for (const [role, def] of Object.entries(m.roles)) {
    for (const p of def.permissions) {
      if (!known.has(p)) throw new Error(`rbac: role ${role} references unknown permission ${p}`);
    }
    if (!def.internal) {
      const staffOnly = def.permissions.filter((p) =>
        /(:all$|note:internal|transition:staff|escalate:level|internal_ref|registration:approve)/.test(p),
      );
      if (staffOnly.length)
        throw new Error(`rbac: external role ${role} holds staff-only permissions ${staffOnly.join(',')}`);
    }
  }
}

export function permissionsFor(roles: readonly RoleKey[], m: RbacMatrix = loadMatrix()): string[] {
  const out = new Set<string>();
  for (const r of roles) for (const p of m.roles[r]?.permissions ?? []) out.add(p);
  return [...out].sort();
}

// ---------- CASL abilities ----------
export type Action =
  | 'read'
  | 'create'
  | 'reply'
  | 'note'
  | 'transition_staff'
  | 'transition_customer'
  | 'escalate_customer'
  | 'escalate_level'
  | 'assign'
  | 'csat';
export type Subject = 'Case' | 'Asset' | 'all';
export type AppAbility = MongoAbility<[Action, Subject | CaseLike | AssetLike]>;

export interface CaseLike {
  __type: 'Case';
  orgId: string;
  requesterId: string;
}
export interface AssetLike {
  __type: 'Asset';
  orgId: string;
}

export interface PrincipalLike {
  userId: string;
  orgId: string;
  delegatedOrgIds: readonly string[];
  permissions: readonly string[];
}

/**
 * Builds the per-request ability. Row-level security in Postgres is the outer wall;
 * this is the inner one that decides own-vs-org-vs-delegated and which actions are allowed.
 */
export function buildAbility(p: PrincipalLike): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  const has = (k: string) => p.permissions.includes(k);

  const caseScopes: Record<string, unknown>[] = [];
  if (has('case:read:all')) caseScopes.push({});
  if (has('case:read:org')) caseScopes.push({ orgId: p.orgId });
  if (has('case:read:delegated') && p.delegatedOrgIds.length)
    caseScopes.push({ orgId: { $in: [...p.delegatedOrgIds] } });
  if (has('case:read:own')) caseScopes.push({ requesterId: p.userId });

  for (const cond of caseScopes) {
    can('read', 'Case', cond as never);
    if (has('case:reply:public')) can('reply', 'Case', cond as never);
    if (has('case:note:internal')) can('note', 'Case', cond as never);
    if (has('case:transition:staff')) can('transition_staff', 'Case', cond as never);
    if (has('case:transition:customer')) can('transition_customer', 'Case', cond as never);
    if (has('case:escalate:customer')) can('escalate_customer', 'Case', cond as never);
    if (has('case:escalate:level')) can('escalate_level', 'Case', cond as never);
    if (has('case:assign')) can('assign', 'Case', cond as never);
  }
  // Only the person who raised the case (or their org admin) rates it.
  if (has('case:csat:submit')) {
    can('csat', 'Case', { requesterId: p.userId } as never);
    if (has('case:read:org')) can('csat', 'Case', { orgId: p.orgId } as never);
  }
  if (has('case:create') || has('case:create:on_behalf')) can('create', 'Case');

  if (has('asset:read:all')) can('read', 'Asset');
  if (has('asset:read:org')) can('read', 'Asset', { orgId: p.orgId } as never);
  if (has('asset:read:delegated') && p.delegatedOrgIds.length)
    can('read', 'Asset', { orgId: { $in: [...p.delegatedOrgIds] } } as never);

  return build({ detectSubjectType: (o) => (o as { __type: Subject }).__type });
}

export const asCase = (c: { orgId: string; requesterId: string }): CaseLike => ({
  __type: 'Case',
  orgId: c.orgId,
  requesterId: c.requesterId,
});
