import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';
import * as C from '@wd/contracts';
import { z } from 'zod';

extendZodWithOpenApi(z);

/**
 * OpenAPI 3.1 generated from the same Zod contracts the API validates with (ADR-010).
 * Every endpoint is registered here; CI fails if a controller route is missing (see test/openapi.int.test.ts).
 */
export function buildOpenApi(serverUrl: string): Record<string, unknown> {
  const r = new OpenAPIRegistry();
  const bearer = r.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Keycloak access token (MFA level). Browsers use the web BFF instead.',
  });
  const sec = [{ [bearer.name]: [] }];
  const problem = {
    description: 'Problem details (RFC 9457)',
    content: { 'application/problem+json': { schema: C.Problem } },
  };
  const json = <T extends z.ZodTypeAny>(schema: T, description = 'OK', example?: unknown) => ({
    description,
    content: { 'application/json': { schema, ...(example ? { example } : {}) } },
  });
  const ref = z.string().describe('Case UUID or number, e.g. WD-2026-000123');
  const caseExample = {
    number: 'WD-2026-000123',
    subject: 'Core switch reboots every 6 hours',
    severity: 'P1',
    status: 'in_progress',
  };

  r.registerPath({
    method: 'get',
    path: '/api/v1/me',
    tags: ['Identity'],
    security: sec,
    responses: { 200: json(C.Me), 401: problem },
  });
  r.registerPath({
    method: 'post',
    path: '/api/v1/public/registrations',
    tags: ['Identity'],
    summary: 'Register an organisation (public, rate-limited)',
    request: {
      body: {
        content: {
          'application/json': {
            schema: C.RegistrationRequest,
            example: {
              organizationName: 'Example Bank Ltd',
              adminName: 'A. Kumar',
              adminEmail: 'it@examplebank.example',
              consentNoticeVersion: '2026-11-01',
              consentGiven: true,
            },
          },
        },
      },
    },
    responses: {
      202: json(
        z.object({ status: z.literal('received'), message: z.string() }),
        'Accepted (same response whether or not the email exists)',
      ),
      400: problem,
      429: problem,
    },
  });
  r.registerPath({
    method: 'get',
    path: '/api/v1/admin/registrations',
    tags: ['Admin'],
    security: sec,
    request: {
      query: z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }),
    },
    responses: { 200: json(z.object({ items: z.array(C.RegistrationSummary) })), 403: problem },
  });
  r.registerPath({
    method: 'post',
    path: '/api/v1/admin/registrations/{id}/decision',
    tags: ['Admin'],
    security: sec,
    request: {
      params: z.object({ id: C.Uuid }),
      body: {
        content: {
          'application/json': { schema: C.RegistrationDecision, example: { decision: 'approve' } },
        },
      },
    },
    responses: { 200: json(z.object({ status: z.string() })), 404: problem, 409: problem },
  });

  r.registerPath({
    method: 'get',
    path: '/api/v1/catalog/families',
    tags: ['Catalog'],
    responses: {
      200: json(z.object({ items: z.array(C.ProductFamily.extend({ productCount: z.number() })) })),
    },
  });
  r.registerPath({
    method: 'get',
    path: '/api/v1/catalog/products',
    tags: ['Catalog'],
    responses: { 200: json(z.object({ items: z.array(C.ProductPublic) })) },
  });
  r.registerPath({
    method: 'get',
    path: '/api/v1/catalog/products/{sku}/internal',
    tags: ['Catalog'],
    summary: 'Internal product mapping (L3, RMA, Sys Admin only)',
    security: sec,
    request: { params: z.object({ sku: z.string() }) },
    responses: { 200: json(C.ProductInternal), 403: problem, 404: problem },
  });

  r.registerPath({
    method: 'get',
    path: '/api/v1/assets',
    tags: ['Assets'],
    security: sec,
    request: { query: z.object({ orgId: C.Uuid.optional() }) },
    responses: { 200: json(z.object({ items: z.array(C.AssetSummary) })) },
  });
  r.registerPath({
    method: 'get',
    path: '/api/v1/assets/validate',
    tags: ['Assets'],
    security: sec,
    request: { query: z.object({ serial: z.string(), orgId: C.Uuid.optional() }) },
    responses: { 200: json(C.SerialValidation) },
  });

  r.registerPath({
    method: 'get',
    path: '/api/v1/cases',
    tags: ['Cases'],
    security: sec,
    request: { query: C.CaseListQuery },
    responses: { 200: json(C.Page(C.CaseSummary)) },
  });
  r.registerPath({
    method: 'post',
    path: '/api/v1/cases',
    tags: ['Cases'],
    security: sec,
    request: {
      body: {
        content: {
          'application/json': {
            schema: C.CreateCaseRequest,
            example: {
              serialNumber: 'WDSW5600A0001',
              severity: 'P1',
              category: 'hardware',
              subject: 'Core switch reboots every 6 hours',
              description: 'Unit reboots with a watchdog timeout.',
              uploadIds: [],
            },
          },
        },
      },
    },
    responses: { 201: json(C.CaseDetail, 'Created case', caseExample), 400: problem, 422: problem },
  });
  r.registerPath({
    method: 'get',
    path: '/api/v1/cases/{ref}',
    tags: ['Cases'],
    security: sec,
    request: { params: z.object({ ref }) },
    responses: { 200: json(C.CaseDetail, 'OK', caseExample), 404: problem },
  });
  r.registerPath({
    method: 'post',
    path: '/api/v1/cases/{ref}/messages',
    tags: ['Cases'],
    security: sec,
    request: {
      params: z.object({ ref }),
      body: {
        content: {
          'application/json': {
            schema: C.ReplyRequest,
            example: {
              visibility: 'public',
              body: 'Please share `display diagnostic-information`.',
              setStatus: 'awaiting_customer',
            },
          },
        },
      },
    },
    responses: { 201: json(C.CaseDetail), 403: problem, 404: problem, 409: problem },
  });
  r.registerPath({
    method: 'post',
    path: '/api/v1/cases/{ref}/transition',
    tags: ['Cases'],
    security: sec,
    request: {
      params: z.object({ ref }),
      headers: z.object({ 'if-match': z.string().optional() }),
      body: {
        content: {
          'application/json': {
            schema: C.TransitionRequest,
            example: { to: 'resolved', note: 'Fixed in WOS 7.1.080.' },
          },
        },
      },
    },
    responses: { 200: json(C.CaseDetail), 409: problem, 412: problem },
  });
  r.registerPath({
    method: 'post',
    path: '/api/v1/cases/{ref}/escalate',
    tags: ['Cases'],
    security: sec,
    request: {
      params: z.object({ ref }),
      body: { content: { 'application/json': { schema: C.EscalateRequest } } },
    },
    responses: { 200: json(C.CaseDetail), 409: problem },
  });
  r.registerPath({
    method: 'post',
    path: '/api/v1/cases/{ref}/assign',
    tags: ['Cases'],
    security: sec,
    request: {
      params: z.object({ ref }),
      body: { content: { 'application/json': { schema: C.AssignRequest } } },
    },
    responses: { 200: json(C.CaseDetail), 422: problem },
  });
  r.registerPath({
    method: 'post',
    path: '/api/v1/cases/{ref}/csat',
    tags: ['Cases'],
    security: sec,
    request: {
      params: z.object({ ref }),
      body: {
        content: {
          'application/json': {
            schema: C.CsatRequest,
            example: { score: 5, comment: 'Quick fix' },
          },
        },
      },
    },
    responses: { 201: json(C.CaseDetail), 409: problem },
  });
  r.registerPath({
    method: 'post',
    path: '/api/v1/public/csat',
    tags: ['Cases'],
    summary: 'Submit CSAT from the emailed link',
    request: {
      body: {
        content: { 'application/json': { schema: C.CsatRequest.extend({ token: z.string() }) } },
      },
    },
    responses: { 204: { description: 'Recorded' }, 404: problem, 409: problem },
  });

  r.registerPath({
    method: 'post',
    path: '/api/v1/uploads',
    tags: ['Attachments'],
    summary:
      'tus 1.0 creation (resumable upload). Headers: Tus-Resumable, Upload-Length, Upload-Metadata (filename)',
    security: sec,
    responses: {
      201: { description: 'Created; Location header has the upload URL' },
      413: problem,
      415: { description: 'File type not accepted' },
    },
  });
  r.registerPath({
    method: 'patch',
    path: '/api/v1/uploads/{id}',
    tags: ['Attachments'],
    summary: 'tus 1.0 chunk upload',
    security: sec,
    request: { params: z.object({ id: z.string() }) },
    responses: { 204: { description: 'Chunk stored' }, 404: problem },
  });
  r.registerPath({
    method: 'get',
    path: '/api/v1/attachments/{id}/url',
    tags: ['Attachments'],
    security: sec,
    request: { params: z.object({ id: C.Uuid }) },
    responses: { 200: json(C.SignedUrl), 404: problem, 409: problem },
  });
  r.registerPath({
    method: 'get',
    path: '/api/v1/files/{token}',
    tags: ['Attachments'],
    summary: 'Signed download (filesystem storage driver only)',
    request: { params: z.object({ token: z.string() }) },
    responses: { 200: { description: 'File stream' }, 404: problem },
  });

  r.registerPath({
    method: 'get',
    path: '/healthz',
    tags: ['Ops'],
    responses: { 200: json(z.object({ status: z.string() })) },
  });
  r.registerPath({
    method: 'get',
    path: '/readyz',
    tags: ['Ops'],
    responses: { 200: json(z.object({ status: z.string() })) },
  });

  return new OpenApiGeneratorV31(r.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'WatchDog Support API',
      version: '1.0.0',
      description:
        'Case management, assets and identity for the WatchDog Support Portal. Errors use RFC 9457 problem+json.',
    },
    servers: [{ url: serverUrl }],
  }) as unknown as Record<string, unknown>;
}
