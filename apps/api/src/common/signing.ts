import { createHmac, timingSafeEqual } from 'node:crypto';

/** Compact HMAC-signed tokens (CSAT links, fs download URLs). Not for authentication sessions. */
export class Signer {
  constructor(private readonly key: string) {}

  mac(data: string, bytes = 32): string {
    return createHmac('sha256', this.key)
      .update(data)
      .digest('base64url')
      .slice(0, Math.ceil((bytes * 4) / 3));
  }

  sign(payload: Record<string, unknown>, ttlSeconds: number): string {
    const body = Buffer.from(
      JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
    ).toString('base64url');
    return `${body}.${this.mac(body)}`;
  }

  verify<T extends Record<string, unknown>>(token: string): (T & { exp: number }) | null {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = this.mac(body);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
      return null;
    try {
      const data = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp: number };
      return data.exp > Date.now() / 1000 ? data : null;
    } catch {
      return null;
    }
  }

  /** Reply-to token for email threading: case+WD-2026-000123.ab12cd34@domain */
  replyToken(caseNumber: string): string {
    return `${caseNumber}.${createHmac('sha256', this.key).update(`reply:${caseNumber}`).digest('hex').slice(0, 8)}`;
  }

  verifyReplyToken(token: string): string | null {
    const m = /^(WD-\d{4}-\d{6})\.([a-f0-9]{8})$/i.exec(token);
    if (!m) return null;
    const expected = this.replyToken(m[1]!.toUpperCase()).split('.')[1]!;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]!.toLowerCase()))
      ? m[1]!.toUpperCase()
      : null;
  }
}
