import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdvisoryDraftRequest, AdvisorySeverity, AdvisorySubscriptionBody } from '@wd/contracts';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import { CONFIG } from '../../tokens.js';
import { Ctx, CurrentPrincipal, Public, RequirePermission } from '../../common/auth.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';
import { AdvisoriesService } from './advisories.service.js';

const WDSA = z.string().regex(/^WDSA-\d{4}-\d{4,}$/);
const ListQuery = z.object({
  severity: AdvisorySeverity.optional(),
  family: z.string().max(40).optional(),
  q: z.string().trim().max(100).optional(),
});

@Controller('api/v1')
export class AdvisoriesController {
  constructor(
    @Inject(AdvisoriesService) private readonly svc: AdvisoriesService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Public()
  @Get('advisories')
  @RateLimit('advisories', 120, 60)
  list(@Req() req: Request, @Query() q: unknown) {
    return this.svc.list(req.wd?.principal, parse(ListQuery, q));
  }

  @Public()
  @Get('advisories/rss.xml')
  @RateLimit('advisories-rss', 60, 60)
  async rss(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(await this.svc.rss(this.cfg.PUBLIC_WEB_URL));
  }

  @Public()
  @Get('advisories/:id')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.svc.get(req.wd?.principal, WDSA.parse(id));
  }

  @Get('me/advisory-subscription')
  subscription(@CurrentPrincipal() p: Principal) {
    return this.svc.getSubscription(p);
  }

  @Put('me/advisory-subscription')
  subscribe(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    return this.svc.subscribe(p, parse(AdvisorySubscriptionBody, body));
  }

  @Delete('me/advisory-subscription')
  @HttpCode(204)
  async unsubscribe(@CurrentPrincipal() p: Principal) {
    await this.svc.unsubscribe(p);
  }

  // ---- PSIRT authoring
  @Get('admin/advisories')
  @RequirePermission('advisory:manage')
  adminList(@CurrentPrincipal() p: Principal) {
    return this.svc.adminList(p);
  }

  @Post('admin/advisories')
  @RequirePermission('advisory:manage')
  create(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.svc.create(p, ctx, parse(AdvisoryDraftRequest, body));
  }

  @Get('admin/advisories/:id')
  @RequirePermission('advisory:manage')
  editorGet(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.svc.editorGet(p, WDSA.parse(id));
  }

  @Put('admin/advisories/:id')
  @RequirePermission('advisory:manage')
  update(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.svc.update(p, ctx, WDSA.parse(id), parse(AdvisoryDraftRequest, body));
  }

  @Post('admin/advisories/:id/publish')
  @HttpCode(200)
  @RequirePermission('advisory:manage')
  publish(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.publish(p, ctx, WDSA.parse(id));
  }

  @Post('admin/advisories/:id/withdraw')
  @HttpCode(200)
  @RequirePermission('advisory:manage')
  withdraw(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), body);
    return this.svc.withdraw(p, ctx, WDSA.parse(id), reason);
  }
}
