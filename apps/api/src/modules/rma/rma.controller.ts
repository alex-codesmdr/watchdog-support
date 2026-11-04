import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RmaCreateRequest, RmaTransitionRequest } from '@wd/contracts';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import { CONFIG } from '../../tokens.js';
import { Ctx, CurrentPrincipal, RequirePermission } from '../../common/auth.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';
import { renderRmaForm } from './rma-form.js';
import { RmaService } from './rma.service.js';

const RMA_NO = z.string().regex(/^RMA-\d{4}-\d{6}$/);
const CASE_NO = z.string().max(40);

@Controller('api/v1')
export class RmaController {
  constructor(
    @Inject(RmaService) private readonly rma: RmaService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get('rmas')
  @RequirePermission('rma:request', 'rma:manage')
  list(
    @CurrentPrincipal() p: Principal,
    @Query('status') status?: string,
    @Query('case') caseNumber?: string,
  ) {
    return this.rma.list(p, {
      status: z
        .enum(['open', 'closed'])
        .optional()
        .parse(status || undefined),
      caseNumber: caseNumber ? CASE_NO.parse(caseNumber) : undefined,
    });
  }

  @Post('cases/:ref/rmas')
  @RequirePermission('rma:request', 'rma:manage')
  @RateLimit('rma-create', 20, 3600)
  create(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('ref') ref: string,
    @Body() body: unknown,
  ) {
    return this.rma.create(p, ctx, CASE_NO.parse(ref), parse(RmaCreateRequest, body));
  }

  @Get('rmas/:number')
  @RequirePermission('rma:request', 'rma:manage')
  get(@CurrentPrincipal() p: Principal, @Param('number') n: string) {
    return this.rma.get(p, RMA_NO.parse(n));
  }

  @Post('rmas/:number/transition')
  @HttpCode(200)
  @RequirePermission('rma:request', 'rma:manage')
  transition(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('number') n: string,
    @Body() body: unknown,
  ) {
    return this.rma.transition(p, ctx, RMA_NO.parse(n), parse(RmaTransitionRequest, body));
  }

  @Get('rmas/:number/form.pdf')
  @RequirePermission('rma:request', 'rma:manage')
  async form(@CurrentPrincipal() p: Principal, @Param('number') n: string, @Res() res: Response) {
    const r = await this.rma.get(p, RMA_NO.parse(n));
    const pdf = await renderRmaForm(r, this.cfg.RMA_RETURN_ADDRESS);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${r.number}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }
}
