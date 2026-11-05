import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  randomInt,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** Symmetric encryption for secrets we must be able to read back (webhook signing secrets). */
export class SecretBox {
  private readonly key: Buffer;
  constructor(appSigningKey: string, purpose: string) {
    this.key = Buffer.from(hkdfSync('sha256', appSigningKey, 'wd-secretbox', purpose, 32));
  }
  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [
      'v1',
      iv.toString('base64url'),
      ct.toString('base64url'),
      c.getAuthTag().toString('base64url'),
    ].join('.');
  }
  open(sealed: string): string {
    const [v, iv, ct, tag] = sealed.split('.');
    if (v !== 'v1' || !iv || !ct || !tag) throw new Error('bad sealed secret');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  }
}

const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const randomString = (n: number, alphabet = B62) =>
  Array.from({ length: n }, () => alphabet[randomInt(alphabet.length)]).join('');

/** API key: `wdk_<prefix>_<secret>`. The prefix is the lookup key; only a scrypt hash is stored. */
export function newApiKey() {
  const prefix = randomString(10, ALNUM);
  const secret = randomString(40);
  return { prefix, secret, token: `wdk_${prefix}_${secret}` };
}
export const API_KEY_RE = /^wdk_([a-z0-9]{10})_([A-Za-z0-9]{40})$/;

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(secret, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${h.toString('base64url')}`;
}
export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const h = await scrypt(secret, Buffer.from(salt, 'base64url'), 32);
  const want = Buffer.from(hash, 'base64url');
  return want.length === h.length && timingSafeEqual(want, h);
}
