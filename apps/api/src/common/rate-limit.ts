import { Inject, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RateLimiterMemory, RateLimiterRedis, type RateLimiterAbstract } from 'rate-limiter-flexible';
import type { Redis } from 'ioredis';
import { ProblemError } from './errors.js';
import { RATE_LIMITER } from '../tokens.js';

export interface RateRule { key: string; points: number; durationSec: number }
const RL = 'wd:ratelimit';
/** Per-route limit, keyed by user when authenticated, else by client IP. */
export const RateLimit = (key: string, points: number, durationSec: number) => SetMetadata(RL, { key, points, durationSec } satisfies RateRule);

export class RateLimiters {
  private readonly cache = new Map<string, RateLimiterAbstract>();
  /** `scale` multiplies every limit (load tests / authorization suites only). */
  constructor(private readonly redis: Redis | null, private readonly scale = 1) {}
  get(rule: RateRule): RateLimiterAbstract {
    const id = `${rule.key}:${rule.points}:${rule.durationSec}`;
    let l = this.cache.get(id);
    if (!l) {
      const opts = { keyPrefix: `rl:${rule.key}`, points: rule.points * this.scale, duration: rule.durationSec };
      l = this.redis ? new RateLimiterRedis({ storeClient: this.redis, ...opts, insuranceLimiter: new RateLimiterMemory(opts) }) : new RateLimiterMemory(opts);
      this.cache.set(id, l);
    }
    return l;
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(RATE_LIMITER) private readonly limiters: RateLimiters) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<RateRule | undefined>(RL, [ctx.getHandler(), ctx.getClass()]);
    if (!rule) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const who = req.wd?.principal?.userId ?? req.wd?.ip ?? 'unknown';
    try {
      const r = await this.limiters.get(rule).consume(who);
      res.setHeader('RateLimit-Remaining', String(r.remainingPoints));
      return true;
    } catch (e) {
      const ms = (e as { msBeforeNext?: number }).msBeforeNext ?? 60_000;
      res.setHeader('Retry-After', String(Math.ceil(ms / 1000)));
      throw new ProblemError(429, 'rate-limited', 'Too many requests. Please wait and try again.');
    }
  }
}
