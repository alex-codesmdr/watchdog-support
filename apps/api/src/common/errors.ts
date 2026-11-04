import { HttpException, HttpStatus } from '@nestjs/common';

/** RFC 9457 problem details. `title` is safe to show to users; never include internals. */
export class ProblemError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    title: string,
    readonly detail?: string,
    readonly errors?: Array<{ path: string; message: string }>,
  ) {
    super(
      { type: `https://support.watchdog.example/problems/${code}`, title, status, detail, errors },
      status,
    );
  }
}

export const notFound = (what = 'Resource') =>
  new ProblemError(HttpStatus.NOT_FOUND, 'not-found', `${what} not found`);
export const forbidden = (detail?: string) =>
  new ProblemError(
    HttpStatus.FORBIDDEN,
    'forbidden',
    'You do not have permission to do this',
    detail,
  );
export const conflict = (code: string, title: string, detail?: string) =>
  new ProblemError(HttpStatus.CONFLICT, code, title, detail);
export const unprocessable = (code: string, title: string, detail?: string) =>
  new ProblemError(HttpStatus.UNPROCESSABLE_ENTITY, code, title, detail);
export const unauthorized = (detail?: string) =>
  new ProblemError(HttpStatus.UNAUTHORIZED, 'unauthorized', 'Authentication required', detail);
