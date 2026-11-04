import { createChallenge, verifySolution, extractParams } from 'altcha-lib';
import type { Redis } from 'ioredis';

/**
 * Self-hosted proof-of-work CAPTCHA (ALTCHA protocol, MIT). The browser searches for a number whose
 * SHA-256 with a server salt matches the challenge: ~0.2–1 s of CPU for a person, expensive at scale
 * for a scraper. No third-party calls, no cookies, works air-gapped. Challenges are HMAC-signed,
 * expire after 5 minutes and are single-use (replay guard in Redis, memory fallback in tests).
 */
export class Captcha {
  private readonly memory = new Map<string, number>();

  constructor(
    private readonly hmacKey: string,
    private readonly redis: Redis | null,
    private readonly maxNumber = 50_000,
  ) {}

  async challenge() {
    return createChallenge({
      hmacKey: this.hmacKey,
      maxNumber: this.maxNumber,
      expires: new Date(Date.now() + 5 * 60_000),
    });
  }

  /** True only for a valid, unexpired, never-before-used solution. */
  async verify(payload: string): Promise<boolean> {
    if (!payload || payload.length > 4000) return false;
    let ok = false;
    try {
      ok = await verifySolution(payload, this.hmacKey, true);
    } catch {
      return false;
    }
    if (!ok) return false;
    let sig: string;
    try {
      sig = (JSON.parse(Buffer.from(payload, 'base64').toString()) as { signature: string })
        .signature;
    } catch {
      return false;
    }
    const expires =
      Number(extractParams(payload).expires ?? 0) || Math.floor(Date.now() / 1000) + 300;
    const ttl = Math.max(1, expires - Math.floor(Date.now() / 1000));
    if (this.redis)
      return (await this.redis.set(`wd:captcha:${sig}`, '1', 'EX', ttl, 'NX')) === 'OK';
    const now = Date.now();
    for (const [k, exp] of this.memory) if (exp < now) this.memory.delete(k);
    if (this.memory.has(sig)) return false;
    this.memory.set(sig, now + ttl * 1000);
    return true;
  }
}
