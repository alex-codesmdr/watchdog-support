import { type ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';

/** Every error leaves the API as application/problem+json with no stack traces or internals. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    let status = 500;
    let body: Record<string, unknown> = {
      type: 'about:blank',
      title: 'Something went wrong. Please try again.',
      status,
    };

    if (err instanceof ZodError) {
      status = 400;
      body = {
        type: 'https://support.watchdog.example/problems/validation',
        title: 'Some fields are invalid',
        status,
        errors: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      const r = err.getResponse();
      body =
        typeof r === 'object' && r && 'title' in r
          ? (r as Record<string, unknown>)
          : { type: 'about:blank', title: httpTitle(status), status };
    } else if (isPg(err)) {
      // Map database guard rails to safe client errors.
      if (err.code === '42501') {
        status = 403;
        body = { type: 'about:blank', title: 'You do not have permission to do this', status };
      } else if (err.code === 'P0002') {
        status = 404;
        body = { type: 'about:blank', title: 'Not found', status };
      } else if (err.code === '23505') {
        status = 409;
        body = { type: 'about:blank', title: 'This already exists', status };
      } else if (err.code === '23P01') {
        status = 409;
        body = { type: 'about:blank', title: 'Overlaps an existing record', status };
      } else if (err.code === '23514' || err.code === '22P02') {
        status = 400;
        body = { type: 'about:blank', title: 'Invalid value', status };
      }
    }
    if (status >= 500) logger.error({ err, requestId: req.wd?.requestId }, 'unhandled error');
    res
      .status(status)
      .type('application/problem+json')
      .json({ ...body, status, instance: req.wd?.requestId });
  }
}

function isPg(e: unknown): e is { code: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { code?: unknown }).code === 'string' &&
    /^[0-9A-Z]{5}$/.test((e as { code: string }).code)
  );
}
function httpTitle(s: number) {
  return (
    (
      {
        400: 'Bad request',
        401: 'Authentication required',
        403: 'Forbidden',
        404: 'Not found',
        413: 'Too large',
        429: 'Too many requests',
      } as Record<number, string>
    )[s] ?? 'Error'
  );
}
