# Keycloak realm `watchdog`

`realm-watchdog.json` is imported by `docker compose` (`start-dev --import-realm`). It is **local/demo
configuration**. Production realms are managed as code with `keycloak-config-cli` using the same file
with secrets injected from the secret store.

What it configures:

| Setting | Value | Why |
|---|---|---|
| Browser flow `browser-mfa` | Cookie, or password (LoA 1) followed by OTP (LoA 2) | MFA for every login; first login forces TOTP enrolment |
| `acr.loa.map` | `{"pwd":1,"mfa":2}` | Tokens carry `acr=mfa`; the API rejects anything else (`AUTH_MFA_ACR_VALUES`) |
| `wd-web` client | confidential, Authorization Code + PKCE S256, `minimum.acr.value=mfa` | BFF client used by the Next.js server |
| Audience mapper | adds `wd-api` to access tokens | API validates `aud` |
| `wd-provisioner` | service account with `manage-users` | API creates users on approval and sends the set-up email |
| Brute force | 5 failures, back-off up to 15 min | ASVS 2.2.1 |
| Password policy | 12+ chars, mixed classes, history 5 | ASVS 2.1 |
| `watchdog-entra` IdP | disabled placeholder | Staff SSO via Entra ID (fill tenant/client in admin console) |

Demo users (local only): every seeded portal user, password `Demo@WatchDog2026`, with a pre-enrolled
TOTP authenticator. Add it to any authenticator app with the base32 secret
`K5QXIY3IIRXWORDFNVXVI33UOBFWK6JSGAZDM===` (SHA-1, 6 digits, 30 s). Real users enrol their own
authenticator on first login.

> Not yet verified against a running Keycloak in this phase's build environment (no container runtime).
> The `e2e-keycloak` CI job boots this realm and runs the Playwright suite against it; treat its first green
> run as the acceptance gate for the realm configuration.
