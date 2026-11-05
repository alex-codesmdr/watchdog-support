import type { RoleKey } from '@wd/contracts';
import type { AppAbility } from '@wd/rbac';

export interface Principal {
  userId: string;
  orgId: string;
  orgType: 'customer' | 'partner' | 'internal';
  isInternal: boolean;
  email: string;
  roles: RoleKey[];
  permissions: string[];
  delegatedOrgIds: string[];
  ability: AppAbility;
  /** Set when the request authenticated with an organisation API key instead of a user session. */
  apiKeyId?: string;
}

export interface RequestContext {
  principal?: Principal;
  requestId: string;
  ip: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    wd?: RequestContext;
  }
}

export const has = (p: Principal, perm: string) => p.permissions.includes(perm);
