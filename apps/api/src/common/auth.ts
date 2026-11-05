import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { sql } from 'kysely';
import { RoleKey } from '@wd/contracts';
import { buildAbility, permissionsFor } from '@wd/rbac';
import type { Request } from 'express';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/database.js';
import { CONFIG, DB, JWKS } from '../tokens.js';
import { forbidden, ProblemError, unauthorized } from './errors.js';
import { logger } from './logger.js';
import { API_KEY_RE, verifySecret } from './secrets.js';
import type { Principal, RequestContext } from './principal.js';

const PUBLIC = 'wd:public';

/** What each API-key scope can do (never more than the creating administrator can). */
export const SCOPE_PERMISSIONS: Record<string, string[]> = {
  'cases:read': ['case:read:org', 'case:read:delegated', 'catalog:read'],
  'cases:write': ['case:create', 'case:reply:public', 'case:transition:customer'],
  'assets:read': ['asset:read:org', 'asset:read:delegated'],
  'rmas:read': ['rma:read'],
};
// A real scrypt hash of a random string, verified when the key prefix is unknown.
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
/** Marks a route as reachable without authentication. */
export const Public = () => SetMetadata(PUBLIC, true);

export const Ctx = createParamDecorator((_d: unknown, ctx: ExecutionContext): RequestContext => {
  return ctx.switchToHttp().getRequest<Request>().wd!;
});
export const CurrentPrincipal = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): Principal => {
    const p = ctx.switchToHttp().getRequest<Request>().wd?.principal;
    if (!p) throw unauthorized();
    return p;
  },
);

interface TokenClaims extends JWTPayload {
  email?: string;
  email_verified?: boolean;
  acr?: string;
}

/**
 * Global guard. Verifies the Keycloak access token (issuer, audience, signature via JWKS, expiry),
 * requires an MFA-level `acr`, then resolves the principal from OUR database — roles are never
 * taken from the token, so a compromised IdP mapping cannot grant portal permissions.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly mfaAcr: Set<string>;

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(JWKS) private readonly jwks: JWTVerifyGetKey,
    @Inject(DB) private readonly db: Database,
  ) {
    this.mfaAcr = new Set(cfg.AUTH_MFA_ACR_VALUES.split(',').map((s) => s.trim()));
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const header = req.headers.authorization;
    if (!header) {
      if (isPublic) return true;
      throw unauthorized();
    }
    if (header.startsWith('WD-Key ')) {
      req.wd!.principal = await this.resolveApiKey(header.slice(7).trim());
      return true;
    }
    const m = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(header);
    if (!m) throw unauthorized('Malformed authorization header');

    let claims: TokenClaims;
    try {
      ({ payload: claims } = await jwtVerify<TokenClaims>(m[1]!, this.jwks, {
        issuer: this.cfg.AUTH_ISSUER,
        audience: this.cfg.AUTH_AUDIENCE,
        algorithms: ['RS256', 'PS256', 'ES256'],
        clockTolerance: 30,
      }));
    } catch (err) {
      // Reason only (never the token): e.g. ERR_JWT_CLAIM_VALIDATION_FAILED "aud", ERR_JWKS_NO_MATCHING_KEY.
      logger.warn(
        {
          code: (err as { code?: string }).code,
          claim: (err as { claim?: string }).claim,
          reason: (err as Error).message,
        },
        'token rejected',
      );
      throw unauthorized('Invalid or expired token');
    }
    if (!claims.sub || !claims.email) throw unauthorized('Token is missing required claims');
    if (this.cfg.AUTH_REQUIRE_MFA && !this.mfaAcr.has(String(claims.acr ?? ''))) {
      logger.warn(
        { acr: claims.acr ?? null, accepted: [...this.mfaAcr] },
        'token rejected: authentication level below MFA',
      );
      throw new ProblemError(401, 'mfa-required', 'Multi-factor authentication is required');
    }

    req.wd!.principal = await this.resolve(claims);
    return true;
  }

  /**
   * Organisation API key (`Authorization: WD-Key wdk_…`). The key acts as the administrator who
   * created it, limited to its scopes: permissions are the intersection, re-checked on every call,
   * so disabling the administrator or their organisation stops the key at once.
   */
  private async resolveApiKey(token: string): Promise<Principal> {
    const m = API_KEY_RE.exec(token);
    if (!m) throw unauthorized('Malformed API key');
    const r = (
      await this.db.withAnonymous((tx) =>
        sql<{
          key_id: string;
          secret_hash: string;
          scopes: string[];
          expires_at: Date | null;
          revoked_at: Date | null;
          user_id: string;
          user_status: string;
          email: string;
          org_id: string;
          org_type: Principal['orgType'];
          org_status: string;
          roles: string[];
          delegated: string[];
        }>`SELECT * FROM wd.resolve_api_key(${m[1]!})`.execute(tx),
      )
    ).rows[0];
    // Same answer for unknown and wrong secrets; verification runs either way (timing).
    const ok = await verifySecret(m[2]!, r?.secret_hash ?? DUMMY_HASH);
    if (!r || !ok) throw unauthorized('Invalid API key');
    if (r.revoked_at) throw unauthorized('This API key was revoked');
    if (r.expires_at && r.expires_at < new Date()) throw unauthorized('This API key has expired');
    if (r.user_status !== 'active' || r.org_status !== 'active')
      throw forbidden('The account behind this API key is not active');
    const roles = r.roles.filter((x): x is RoleKey => RoleKey.safeParse(x).success);
    const own = permissionsFor(roles);
    const permissions = r.scopes
      .flatMap((s) => SCOPE_PERMISSIONS[s] ?? [])
      .filter((x) => own.includes(x) || (x === 'rma:read' && own.includes('rma:request')));
    await this.db.withAnonymous((tx) =>
      sql`SELECT wd.touch_api_key(${r.key_id}::uuid)`.execute(tx),
    );
    const delegatedOrgIds = r.org_type === 'partner' ? r.delegated : [];
    return {
      userId: r.user_id,
      orgId: r.org_id,
      orgType: r.org_type,
      isInternal: false,
      email: r.email,
      roles,
      permissions,
      delegatedOrgIds,
      ability: buildAbility({ userId: r.user_id, orgId: r.org_id, delegatedOrgIds, permissions }),
      apiKeyId: r.key_id,
    };
  }

  private async resolve(c: TokenClaims): Promise<Principal> {
    const rows = await this.db.withAnonymous((tx) =>
      sql<{
        user_id: string;
        org_id: string;
        org_type: Principal['orgType'];
        org_status: string;
        user_status: string;
        roles: string[];
        delegated: string[];
      }>`
        SELECT * FROM wd.resolve_principal(${c.sub!}, ${c.email!.toLowerCase()}, ${c.email_verified === true})`.execute(
        tx,
      ),
    );
    const r = rows.rows[0];
    if (!r) {
      // Diagnose without leaking: does an account with this email exist, and is it linked elsewhere?
      const acct = await this.db
        .withSystem((tx) =>
          tx
            .selectFrom('app_user')
            .select(['status', sql<boolean>`kc_subject IS NOT NULL`.as('linked')])
            .where('email', '=', c.email!.toLowerCase())
            .executeTakeFirst(),
        )
        .catch(() => undefined);
      logger.warn(
        {
          sub: c.sub,
          emailVerified: c.email_verified,
          accountExists: Boolean(acct),
          accountStatus: acct?.status,
          linkedToAnotherIdentity: acct?.linked ?? false,
        },
        'no portal account for authenticated identity',
      );
      throw forbidden('Your account has not been provisioned for the support portal.');
    }
    if (r.user_status !== 'active') throw forbidden('Your account is disabled.');
    if (r.org_status !== 'active')
      throw forbidden(
        'Your organisation is not active yet. You will be notified once it is approved.',
      );
    const roles = r.roles.filter((x): x is RoleKey => RoleKey.safeParse(x).success);
    const permissions = permissionsFor(roles);
    const isInternal = r.org_type === 'internal';
    const delegatedOrgIds = r.org_type === 'partner' ? r.delegated : [];
    return {
      userId: r.user_id,
      orgId: r.org_id,
      orgType: r.org_type,
      isInternal,
      email: c.email!.toLowerCase(),
      roles,
      permissions,
      delegatedOrgIds,
      ability: buildAbility({ userId: r.user_id, orgId: r.org_id, delegatedOrgIds, permissions }),
    };
  }
}

/** Route-level permission requirement (checked after authentication). */
const PERMS = 'wd:perms';
export const RequirePermission = (...anyOf: string[]) => SetMetadata(PERMS, anyOf);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const anyOf = this.reflector.getAllAndOverride<string[] | undefined>(PERMS, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!anyOf?.length) return true;
    const p = ctx.switchToHttp().getRequest<Request>().wd?.principal;
    if (!p) throw unauthorized();
    if (!anyOf.some((perm) => p.permissions.includes(perm))) throw forbidden();
    return true;
  }
}
