/**
 * Minimal OpenID Connect provider for local E2E tests and demos without Keycloak.
 * NOT FOR PRODUCTION. Issues RS256 tokens with acr=mfa for the seeded WatchDog demo users.
 *   node e2e/mock-oidc.mjs   (port 8080, issuer http://localhost:8080/realms/watchdog)
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const PORT = Number(process.env.MOCK_OIDC_PORT ?? 8080);
const ISSUER = `http://localhost:${PORT}/realms/watchdog`;
const USERS = [
  ['noc@kaveribank.example', 'Lakshmi Nair', 'Customer user, Kaveri Cooperative Bank'],
  ['it.admin@kaveribank.example', 'Suresh Gowda', 'Customer admin, Kaveri Cooperative Bank'],
  ['netops@narmadacity.example', 'Kavya Patel', 'Customer user, Narmada Smart City'],
  ['support@sahyadri-si.example', 'Nikhil Joshi', 'Partner, Sahyadri SI'],
  ['asha.l1@watchdog.example', 'Asha Menon', 'L1 engineer'],
  ['vikram.l2@watchdog.example', 'Vikram Rao', 'L2 engineer'],
  ['rohan.manager@watchdog.example', 'Rohan Iyer', 'Support manager'],
  ['farah.l3@watchdog.example', 'Farah Qureshi', 'L3 engineer'],
  ['meera.content@watchdog.example', 'Meera Pillai', 'Content editor'],
  ['arjun.rma@watchdog.example', 'Arjun Das', 'RMA coordinator'],
  ['admin@narmadacity.example', 'Imran Shaikh', 'Customer admin, Narmada Smart City'],
  ['neha.admin@watchdog.example', 'Neha Kulkarni', 'System admin'],
];
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'mock', alg: 'RS256', use: 'sig' };
const codes = new Map();
const refresh = new Map();

const sign = (claims, aud, ttl) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'mock' })
    .setIssuer(ISSUER)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(privateKey);
async function tokens(email, nonce) {
  const u = USERS.find((x) => x[0] === email);
  const base = {
    sub: `mock-${email}`,
    email,
    email_verified: true,
    name: u?.[1] ?? email,
    acr: 'mfa',
  };
  const rt = randomBytes(24).toString('base64url');
  refresh.set(rt, email);
  return {
    access_token: await sign({ ...base, azp: 'wd-web' }, 'wd-api', 300),
    id_token: await sign({ ...base, nonce }, 'wd-web', 300),
    refresh_token: rt,
    token_type: 'Bearer',
    expires_in: 300,
  };
}
const body = (req) =>
  new Promise((r) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => r(new URLSearchParams(b)));
  });
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

createServer(async (req, res) => {
  const url = new URL(req.url, ISSUER);
  const p = url.pathname.replace('/realms/watchdog', '');
  const json = (o, s = 200) => {
    res.writeHead(s, { 'content-type': 'application/json' });
    res.end(JSON.stringify(o));
  };
  if (p === '/.well-known/openid-configuration')
    return json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
      token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
      end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
      jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
    });
  if (p === '/protocol/openid-connect/certs') return json({ keys: [jwk] });
  if (p === '/protocol/openid-connect/auth' && req.method === 'GET') {
    const q = url.searchParams;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo sign-in</title>
      <style>body{font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#16202e}button{display:block;width:100%;text-align:left;margin:.4rem 0;padding:.7rem 1rem;border:1px solid #d6dde7;border-radius:6px;background:#fff;font:inherit;cursor:pointer}button:hover{border-color:#0b2545}small{color:#546276}</style></head>
      <body><h1>Demo sign-in</h1><p><small>Local mock identity provider. Password and authenticator steps are simulated.</small></p>
      <form method="post">${['redirect_uri', 'state', 'nonce', 'code_challenge'].map((k) => `<input type="hidden" name="${k}" value="${esc(q.get(k) ?? '')}">`).join('')}
      ${USERS.map(([e, n, r]) => `<button name="email" value="${esc(e)}">${esc(n)}<br><small>${esc(r)}</small></button>`).join('')}</form></body></html>`);
  }
  if (p === '/protocol/openid-connect/auth' && req.method === 'POST') {
    const f = await body(req);
    const code = randomBytes(16).toString('hex');
    codes.set(code, {
      email: f.get('email'),
      nonce: f.get('nonce'),
      challenge: f.get('code_challenge'),
    });
    const to = new URL(f.get('redirect_uri'));
    to.searchParams.set('code', code);
    to.searchParams.set('state', f.get('state'));
    res.writeHead(302, { location: to.toString() });
    return res.end();
  }
  if (p === '/protocol/openid-connect/token') {
    const f = await body(req);
    if (f.get('grant_type') === 'authorization_code') {
      const c = codes.get(f.get('code'));
      codes.delete(f.get('code'));
      if (
        !c ||
        createHash('sha256')
          .update(f.get('code_verifier') ?? '')
          .digest('base64url') !== c.challenge
      )
        return json({ error: 'invalid_grant' }, 400);
      return json(await tokens(c.email, c.nonce));
    }
    if (f.get('grant_type') === 'refresh_token') {
      const email = refresh.get(f.get('refresh_token'));
      if (!email) return json({ error: 'invalid_grant' }, 400);
      return json(await tokens(email, undefined));
    }
    return json({ error: 'unsupported_grant_type' }, 400);
  }
  if (p === '/protocol/openid-connect/logout') {
    res.writeHead(302, { location: url.searchParams.get('post_logout_redirect_uri') ?? '/' });
    return res.end();
  }
  // Webhook receiver for E2E: accepts any signed POST.
  if (url.pathname === '/webhook-sink' && req.method === 'POST') {
    req.resume();
    return void req.on('end', () => res.writeHead(204).end());
  }
  res.writeHead(404).end();
}).listen(PORT, () => console.log(`mock OIDC on ${ISSUER}`));
