# OWASP ASVS 4.0.3 Level 2: controls implemented in Phase 2

Evidence column points at code or tests. Gaps are tracked to their phase.

| ASVS | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 1.4.1 | Trusted enforcement points for access control | Done | Global `AuthGuard`/`PermissionGuard`; RLS (`db/migrations`) |
| 2.1.1–2.1.9 | Password length/complexity/breach | Done (IdP) | Keycloak password policy (`deploy/keycloak`) |
| 2.2.1 | Anti-automation on authentication | Done (IdP) | Keycloak brute-force protection |
| 2.8 / 2.7 | MFA (TOTP) | Done | `browser-mfa` flow; API rejects non-`mfa` tokens (`case-lifecycle.int.test.ts` "requires MFA") |
| 3.4.1–3.4.5 | Cookie attributes | Done | `__Host-` prefix, HttpOnly, Secure, SameSite=Lax (`apps/web/src/lib/session.ts`) |
| 3.5.2 | Tokens not exposed to browser JS | Done | BFF proxy keeps tokens server-side |
| 4.1.1 / 4.1.3 | Least privilege, deny by default | Done | RBAC matrix + generated tests (`rbac-matrix.int.test.ts`) |
| 4.2.1 | IDOR protection | Done | RLS + CASL + 404; `tenant-isolation.int.test.ts` |
| 4.2.2 | CSRF | Done | CSRF token + Origin check on all mutations (`app/api/[...path]/route.ts`) |
| 5.1.3 / 5.1.4 | Input validation (allowlists, schemas) | Done | Zod contracts on every endpoint |
| 5.2.1 | Sanitise untrusted HTML | Done | `sanitize.ts` + tests |
| 5.3.3 | Output encoding / XSS | Done | React escaping; server-sanitised HTML only; CSP with nonces |
| 5.3.4 | SQL injection | Done | Kysely parameterised queries only; `pg` import banned outside `db/` (ESLint) |
| 7.1.1 | No credentials/PII in logs | Done | pino redaction (`common/logger.ts`) |
| 7.4.1 | Generic error messages | Done | RFC 9457 problem filter, no stack traces |
| 8.3.4 | Sensitive data identified, protected | Partial | OEM mapping column privilege; field encryption of phone/GSTIN is Phase 4 |
| 9.1.1 | TLS for all connections | Infra | Ingress/HSTS in production; Phase 5 Helm |
| 10.3.2 | Dependency/supply-chain checks | Done | pnpm audit, Trivy, SBOM, gitleaks in CI |
| 12.1.1 / 12.1.2 | Upload size limits, compressed file checks | Partial | tus size limit; archive-bomb ratio checks Phase 3 |
| 12.2.1 | File type validation by content | Done | Extension allowlist + magic-byte executable rejection |
| 12.4.1 / 12.5.2 | Files stored outside webroot, served as attachment | Done | Object storage, signed URLs, `Content-Disposition: attachment`, `nosniff` |
| 12.6.1 | SSRF | Planned | `SafeHttpClient` arrives with webhooks (Phase 4) |
| 13.2.1 | HTTP method restrictions | Done | Nest routing; proxy only forwards allowed headers |
| 14.4.x | Security headers | Done | helmet (API), CSP/HSTS/XFO/Referrer-Policy (web) |
| 7.3.3 | Tamper-evident audit log | Done | Hash chain + `wd.audit_verify()` test |
