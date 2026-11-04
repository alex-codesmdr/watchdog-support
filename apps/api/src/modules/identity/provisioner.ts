import { logger } from '../../common/logger.js';
import type { AppConfig } from '../../config.js';

/** Creates the login identity for an approved user and sends the set-up email (password + TOTP). */
export interface IdentityProvisioner {
  invite(user: { email: string; displayName: string }): Promise<void>;
}

export class MockProvisioner implements IdentityProvisioner {
  readonly invited: string[] = [];
  async invite(user: { email: string }): Promise<void> {
    this.invited.push(user.email);
    logger.info({ email: user.email }, '[mock] identity invite');
  }
}

/** Keycloak Admin REST (service-account client with realm-management: manage-users). */
export class KeycloakProvisioner implements IdentityProvisioner {
  constructor(private readonly cfg: AppConfig) {}

  private async token(): Promise<string> {
    const r = await fetch(`${this.cfg.KEYCLOAK_ADMIN_URL}/realms/${this.cfg.KEYCLOAK_REALM}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.cfg.KEYCLOAK_ADMIN_CLIENT_ID ?? '', client_secret: this.cfg.KEYCLOAK_ADMIN_CLIENT_SECRET ?? '' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`keycloak token ${r.status}`);
    return ((await r.json()) as { access_token: string }).access_token;
  }

  async invite(user: { email: string; displayName: string }): Promise<void> {
    const base = `${this.cfg.KEYCLOAK_ADMIN_URL}/admin/realms/${this.cfg.KEYCLOAK_REALM}`;
    const auth = { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' };
    const [first, ...rest] = user.displayName.split(' ');
    const create = await fetch(`${base}/users`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        username: user.email,
        email: user.email,
        firstName: first,
        lastName: rest.join(' ') || '-',
        enabled: true,
        emailVerified: false,
        requiredActions: ['VERIFY_EMAIL', 'UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (create.status !== 201 && create.status !== 409) throw new Error(`keycloak create user ${create.status}`);
    const found = await fetch(`${base}/users?exact=true&email=${encodeURIComponent(user.email)}`, { headers: auth });
    const [kc] = (await found.json()) as Array<{ id: string }>;
    if (!kc) throw new Error('keycloak user not found after create');
    const mail = await fetch(`${base}/users/${kc.id}/execute-actions-email?lifespan=259200&client_id=wd-web&redirect_uri=${encodeURIComponent(this.cfg.PUBLIC_WEB_URL)}`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify(['VERIFY_EMAIL', 'UPDATE_PASSWORD', 'CONFIGURE_TOTP']),
    });
    if (!mail.ok) throw new Error(`keycloak execute-actions-email ${mail.status}`);
  }
}
