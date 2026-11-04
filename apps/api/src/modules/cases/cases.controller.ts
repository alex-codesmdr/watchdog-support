import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  AssignRequest,
  CaseListQuery,
  CreateCaseRequest,
  CsatRequest,
  EscalateRequest,
  ReplyRequest,
  TransitionRequest,
} from '@wd/contracts';
import { z } from 'zod';
import { Ctx, CurrentPrincipal, Public, RequirePermission } from '../../common/auth.js';
import { RateLimit } from '../../common/rate-limit.js';
import { notFound } from '../../common/errors.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { Signer } from '../../common/signing.js';
import { parse } from '../../common/zod.js';
import type { AppConfig } from '../../config.js';
import { CONFIG } from '../../tokens.js';
import { CasesService } from './cases.service.js';

const READ = ['case:read:own', 'case:read:org', 'case:read:delegated', 'case:read:all'];

@Controller('api/v1/cases')
export class CasesController {
  constructor(@Inject(CasesService) private readonly cases: CasesService) {}

  @Get()
  @RequirePermission(...READ)
  list(@CurrentPrincipal() p: Principal, @Query() q: unknown) {
    return this.cases.list(p, parse(CaseListQuery, q));
  }

  @Post()
  @RequirePermission('case:create', 'case:create:on_behalf')
  @RateLimit('case-create', 30, 3600)
  async create(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    const c = await this.cases.create(p, ctx, parse(CreateCaseRequest, body));
    return this.cases.get(p, c.id);
  }

  @Get(':ref')
  @RequirePermission(...READ)
  get(@CurrentPrincipal() p: Principal, @Param('ref') ref: string) {
    return this.cases.get(p, ref);
  }

  @Post(':ref/messages')
  @HttpCode(201)
  @RateLimit('case-reply', 120, 3600)
  reply(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('ref') ref: string,
    @Body() body: unknown,
  ) {
    return this.cases.reply(p, ctx, ref, parse(ReplyRequest, body));
  }

  @Post(':ref/transition')
  @HttpCode(200)
  transition(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('ref') ref: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch?: string,
  ) {
    const b = parse(TransitionRequest, body);
    const v = ifMatch ? Number(ifMatch.replace(/"/g, '')) : undefined;
    return this.cases.transition(p, ctx, ref, b.to, b.note, Number.isFinite(v) ? v : undefined);
  }

  @Post(':ref/escalate')
  @HttpCode(200)
  @RateLimit('case-escalate', 10, 3600)
  escalate(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('ref') ref: string,
    @Body() body: unknown,
  ) {
    return this.cases.escalate(p, ctx, ref, parse(EscalateRequest, body).justification);
  }

  @Post(':ref/assign')
  @HttpCode(200)
  @RequirePermission('case:assign')
  assign(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('ref') ref: string,
    @Body() body: unknown,
  ) {
    return this.cases.assign(p, ctx, ref, parse(AssignRequest, body).assigneeId);
  }

  @Post(':ref/csat')
  @HttpCode(201)
  csat(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('ref') ref: string,
    @Body() body: unknown,
  ) {
    return this.cases.csat(p, ctx, ref, parse(CsatRequest, body));
  }
}

@Controller('api/v1/public/csat')
export class PublicCsatController {
  private readonly signer: Signer;
  constructor(
    @Inject(CasesService) private readonly cases: CasesService,
    @Inject(CONFIG) cfg: AppConfig,
  ) {
    this.signer = new Signer(cfg.APP_SIGNING_KEY);
  }

  @Public()
  @Post()
  @HttpCode(204)
  @RateLimit('csat-public', 20, 3600)
  async submit(@Body() body: unknown) {
    const b = parse(CsatRequest.extend({ token: z.string().min(10).max(2000) }), body);
    const t = this.signer.verify<{ c: string; u: string; k: string }>(b.token);
    if (!t || t.k !== 'csat') throw notFound('Survey');
    await this.cases.csatByToken(t.c, t.u, b);
  }
}
