import { Controller, Get, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Database } from '../db/database.js';
import { Public } from '../common/auth.js';
import { DB, REDIS } from '../tokens.js';

@Controller()
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database, @Inject(REDIS) private readonly redis: Redis | null) {}

  @Public()
  @Get('healthz')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('readyz')
  async ready() {
    await this.db.ping();
    if (this.redis) await this.redis.ping();
    return { status: 'ready' };
  }
}
