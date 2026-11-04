import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { KbDraftRequest, KbFeedbackRequest, KbSearchQuery, KbState } from '@wd/contracts';
import { z } from 'zod';
import { Ctx, CurrentPrincipal, Public, RequirePermission } from '../../common/auth.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';
import { KbService } from './kb.service.js';

const uuid = z.string().uuid();

/** Public (optionally authenticated) knowledge-base reading and search. */
@Controller('api/v1/kb')
export class KbController {
  constructor(@Inject(KbService) private readonly kb: KbService) {}

  @Public()
  @Get('search')
  @RateLimit('kb-search', 120, 60)
  search(@Req() req: Request, @Query() q: unknown) {
    return this.kb.search(req.wd?.principal, parse(KbSearchQuery, q));
  }

  @Public()
  @Get('suggest')
  @RateLimit('kb-suggest', 120, 60)
  async suggest(@Req() req: Request, @Query('q') q?: string) {
    return {
      items: await this.kb.suggest(
        req.wd?.principal,
        z
          .string()
          .trim()
          .max(200)
          .parse(q ?? ''),
      ),
    };
  }

  @Public()
  @Get('articles/:slug')
  article(@Req() req: Request, @Param('slug') slug: string) {
    return this.kb.article(req.wd?.principal, z.string().max(120).parse(slug));
  }

  @Public()
  @Post('articles/:slug/feedback')
  @HttpCode(204)
  @RateLimit('kb-feedback', 20, 3600)
  async feedback(@Req() req: Request, @Param('slug') slug: string, @Body() body: unknown) {
    const b = parse(KbFeedbackRequest, body);
    await this.kb.feedback(req.wd?.principal, slug, b.helpful, b.comment);
  }
}

/** Authoring workflow: draft → review → published (→ archived). Versions are immutable. */
@Controller('api/v1/kb/editor')
export class KbEditorController {
  constructor(@Inject(KbService) private readonly kb: KbService) {}

  @Get('articles')
  @RequirePermission('kb:draft')
  async list(@CurrentPrincipal() p: Principal, @Query('state') state?: string) {
    return { items: await this.kb.editorList(p, state ? KbState.parse(state) : undefined) };
  }

  @Post('articles')
  @RequirePermission('kb:draft')
  create(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.kb.create(p, ctx, parse(KbDraftRequest, body));
  }

  @Get('articles/:id')
  @RequirePermission('kb:draft')
  get(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.kb.editorGet(p, uuid.parse(id));
  }

  @Put('articles/:id')
  @RequirePermission('kb:draft')
  update(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.kb.update(p, ctx, uuid.parse(id), parse(KbDraftRequest, body));
  }

  @Post('articles/:id/submit')
  @HttpCode(200)
  @RequirePermission('kb:draft')
  submit(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.kb.submit(p, ctx, uuid.parse(id));
  }

  @Post('articles/:id/publish')
  @HttpCode(200)
  @RequirePermission('kb:publish')
  publish(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.kb.publish(p, ctx, uuid.parse(id));
  }

  @Post('articles/:id/archive')
  @HttpCode(200)
  @RequirePermission('kb:publish')
  archive(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.kb.archive(p, ctx, uuid.parse(id));
  }

  @Post('from-case/:ref')
  @RequirePermission('kb:draft')
  fromCase(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('ref') ref: string,
  ) {
    return this.kb.draftFromCase(p, ctx, z.string().max(40).parse(ref));
  }
}
