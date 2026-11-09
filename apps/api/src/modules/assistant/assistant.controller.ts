import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AssistantAsk, AssistantFeedback, type AssistantAnswer } from '@wd/contracts';
import { z } from 'zod';
import { CurrentPrincipal, Public, RequirePermission } from '../../common/auth.js';
import { notFound } from '../../common/errors.js';
import type { Principal } from '../../common/principal.js';
import { RateLimit } from '../../common/rate-limit.js';
import { parse } from '../../common/zod.js';
import { AssistantService } from './assistant.service.js';

@Controller('api/v1/assistant')
export class AssistantController {
  constructor(@Inject(AssistantService) private readonly assistant: AssistantService) {}

  @Public()
  @Post('ask')
  @HttpCode(200)
  @RateLimit('assistant', 20, 600)
  ask(@Req() req: Request, @Body() body: unknown): Promise<AssistantAnswer> {
    const { question } = parse(AssistantAsk, body);
    return this.assistant.ask(req.wd?.principal, question);
  }

  @Public()
  @Post(':id/feedback')
  @HttpCode(204)
  @RateLimit('assistant-feedback', 60, 600)
  async feedback(@Req() req: Request, @Param('id') raw: string, @Body() body: unknown) {
    const id = parse(z.string().uuid(), raw);
    const { helpful } = parse(AssistantFeedback, body);
    if (!(await this.assistant.feedback(req.wd?.principal, id, helpful))) throw notFound('Answer');
  }

  /** Questions the knowledge base could not answer, for editors to fill gaps. */
  @Get('gaps')
  @RequirePermission('kb:draft')
  async gaps(@CurrentPrincipal() p: Principal) {
    const rows = await this.assistant.gaps(p);
    return {
      items: rows.map((r) => ({
        question: r.question,
        askedAt: r.created_at.toISOString(),
        reason: r.found ? 'Marked not helpful' : 'No article found',
      })),
    };
  }
}
