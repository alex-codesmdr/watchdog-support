/** DI tokens. Explicit tokens keep DI working under esbuild/tsx (no decorator metadata needed). */
export const CONFIG = Symbol('CONFIG');
export const DB = Symbol('DB');
export const JWKS = Symbol('JWKS');
export const OBJECT_STORE = Symbol('OBJECT_STORE');
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');
export const SMS_ADAPTER = Symbol('SMS_ADAPTER');
export const IDENTITY_PROVISIONER = Symbol('IDENTITY_PROVISIONER');
export const AV_SCANNER = Symbol('AV_SCANNER');
export const OUTBOX_DISPATCH = Symbol('OUTBOX_DISPATCH');
export const RATE_LIMITER = Symbol('RATE_LIMITER');
export const REDIS = Symbol('REDIS');
