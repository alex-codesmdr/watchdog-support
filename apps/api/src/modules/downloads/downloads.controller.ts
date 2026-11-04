import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ReleaseDraftRequest, ReleaseListQuery, ReleaseStatusRequest } from '@wd/contracts';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import { CONFIG } from '../../tokens.js';
import { Ctx, CurrentPrincipal, Public, RequirePermission } from '../../common/auth.js';
import { unprocessable } from '../../common/errors.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';
import { DownloadsService } from './downloads.service.js';

const uuid = z.string().uuid();
const FILE_NAME = /^[A-Za-z0-9._() -]{1,200}$/;

/** Download centre for customers, partners and the public. Optional sign-in decides access. */
@Controller('api/v1/downloads')
export class DownloadsController {
  constructor(@Inject(DownloadsService) private readonly svc: DownloadsService) {}

  @Public()
  @Get()
  @RateLimit('downloads-list', 120, 60)
  list(@Req() req: Request, @Query() q: unknown) {
    return this.svc.list(req.wd?.principal, parse(ReleaseListQuery, q));
  }

  @Public()
  @Get('releases/:id')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.svc.get(req.wd?.principal, uuid.parse(id));
  }

  @Public()
  @Post('files/:id/link')
  @HttpCode(200)
  @RateLimit('download-link', 60, 3600)
  link(@Req() req: Request, @Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.link(req.wd?.principal, ctx, uuid.parse(id));
  }

  @Public()
  @Get('eulas/:id')
  eula(@Param('id') id: string) {
    return this.svc.eula(uuid.parse(id));
  }

  @Post('eulas/:id/accept')
  @HttpCode(204)
  async accept(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    await this.svc.acceptEula(p, ctx, uuid.parse(id));
  }
}

/** Staff authoring: draft → upload files (scanned) → publish → deprecate or withdraw. */
@Controller('api/v1/admin/releases')
export class ReleasesAdminController {
  constructor(
    @Inject(DownloadsService) private readonly svc: DownloadsService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get()
  @RequirePermission('release:manage')
  list(@CurrentPrincipal() p: Principal) {
    return this.svc.adminList(p);
  }

  @Get('eulas')
  @RequirePermission('release:manage')
  eulas() {
    return this.svc.eulas();
  }

  @Post()
  @RequirePermission('release:manage')
  create(@CurrentPrincipal() p: Principal, @Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.svc.create(p, ctx, parse(ReleaseDraftRequest, body));
  }

  @Put(':id')
  @RequirePermission('release:manage')
  update(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.svc.update(p, ctx, uuid.parse(id), parse(ReleaseDraftRequest, body));
  }

  @Patch(':id/status')
  @RequirePermission('release:manage')
  status(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.svc.setStatus(p, ctx, uuid.parse(id), parse(ReleaseStatusRequest, body).status);
  }

  /** Raw request body (application/octet-stream), streamed to quarantine. `?fileName=` names it. */
  @Post(':id/files')
  @RequirePermission('release:manage')
  async upload(
    @CurrentPrincipal() p: Principal,
    @Ctx() ctx: RequestContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Query('fileName') fileName?: string,
  ) {
    if (!fileName || !FILE_NAME.test(fileName))
      throw unprocessable(
        'fileName',
        'Name the file with letters, digits, spaces, dots, hyphens or brackets',
      );
    return this.svc.addFile(p, ctx, uuid.parse(id), fileName, req, this.cfg.UPLOAD_MAX_BYTES);
  }
}
