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
 * `buildOpenApi` is the full staff document (non-production only); `buildIntegratorOpenApi` is the
 * public document for customer systems using API keys (test/openapi.int.test.ts checks both).
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
              body: 'Please attach the diagnostic file from the device.',
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

  const rmaNo = z.string().describe('RMA number, e.g. RMA-2026-000042');
  r.registerPath({
    method: 'get',
    path: '/api/v1/rmas',
    tags: ['RMA'],
    summary: 'Replacements (RMA) the caller can see',
    security: sec,
    request: {
      query: z.object({
        status: z.enum(['open', 'closed']).optional(),
        case: z.string().optional(),
      }),
    },
    responses: {
      200: json(z.object({ items: z.array(C.RmaSummary) })),
      401: problem,
      403: problem,
    },
  });
  r.registerPath({
    method: 'get',
    path: '/api/v1/rmas/{number}',
    tags: ['RMA'],
    security: sec,
    request: { params: z.object({ number: rmaNo }) },
    responses: { 200: json(C.RmaView), 404: problem },
  });
  r.registerPath({
    method: 'post',
    path: '/api/v1/cases/{ref}/rmas',
    tags: ['RMA'],
    summary: 'Request a hardware replacement from a case (staff only via API)',
    security: sec,
    request: {
      params: z.object({ ref }),
      body: { content: { 'application/json': { schema: C.RmaCreateRequest } } },
    },
    responses: { 201: json(C.RmaView), 409: problem, 422: problem },
  });
  r.registerPath({
    method: 'post',
    path: '/api/v1/rmas/{number}/transition',
    tags: ['RMA'],
    security: sec,
    request: {
      params: z.object({ number: rmaNo }),
      body: { content: { 'application/json': { schema: C.RmaTransitionRequest } } },
    },
    responses: { 200: json(C.RmaView), 409: problem, 422: problem },
  });
  r.registerPath({
    method: 'get',
    path: '/api/v1/advisories',
    tags: ['Security advisories'],
    summary: 'Published security advisories (public)',
    request: {
      query: z.object({
        severity: C.AdvisorySeverity.optional(),
        family: z.string().optional(),
        q: z.string().optional(),
      }),
    },
    responses: { 200: json(z.object({ items: z.array(C.AdvisorySummary) })) },
  });
  r.registerPath({
    method: 'get',
    path: '/api/v1/advisories/{id}',
    tags: ['Security advisories'],
    request: { params: z.object({ id: z.string().describe('e.g. WDSA-2026-0001') }) },
    responses: { 200: json(C.AdvisoryView), 404: problem },
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

/** Endpoints a customer system can call with an organisation API key. */
const INTEGRATOR_PATHS: Record<string, string[]> = {
  '/api/v1/me': ['get'],
  '/api/v1/cases': ['get', 'post'],
  '/api/v1/cases/{ref}': ['get'],
  '/api/v1/cases/{ref}/messages': ['post'],
  '/api/v1/cases/{ref}/transition': ['post'],
  '/api/v1/assets': ['get'],
  '/api/v1/assets/validate': ['get'],
  '/api/v1/catalog/families': ['get'],
  '/api/v1/catalog/products': ['get'],
  '/api/v1/rmas': ['get'],
  '/api/v1/rmas/{number}': ['get'],
  '/api/v1/advisories': ['get'],
  '/api/v1/advisories/{id}': ['get'],
};

/** Removes component schemas that no remaining path refers to (directly or through other schemas). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated JSON document
function prune(doc: Record<string, any>) {
  const schemas: Record<string, unknown> = doc.components?.schemas ?? {};
  const used = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        if (k === '$ref' && typeof x === 'string') {
          const name = x.split('/').pop()!;
          if (!used.has(name)) {
            used.add(name);
            walk(schemas[name]);
          }
        } else walk(x);
      }
  };
  walk(doc.paths);
  walk(doc.webhooks);
  for (const k of Object.keys(schemas)) if (!used.has(k)) delete schemas[k];
}

/**
 * Public API description for integrators: API-key authentication, only the endpoints a key can
 * reach, and the signed webhook events. Nothing staff-only appears here.
 */
export function buildIntegratorOpenApi(serverUrl: string): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = buildOpenApi(serverUrl) as Record<string, any>;
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [p, methods] of Object.entries(INTEGRATOR_PATHS)) {
    const item = doc.paths[p];
    if (!item) continue;
    paths[p] = {};
    for (const m of methods)
      if (item[m])
        paths[p][m] = { ...item[m], ...(item[m].security ? { security: [{ apiKey: [] }] } : {}) };
  }
  doc.paths = paths;
  doc.info = {
    title: 'WatchDog Support API for integrations',
    version: '1.0.0',
    description: [
      'Connect your ticketing, monitoring or asset system to WatchDog Support.',
      '',
      'Authenticate with an organisation API key created by your administrator under Integrations:',
      '`Authorization: WD-Key wdk_…`. A key acts as the administrator who created it, limited to its',
      'scopes (`cases:read`, `cases:write`, `assets:read`, `rmas:read`). Errors use RFC 9457',
      'problem+json. Requests are rate limited; respect `Retry-After`.',
      '',
      'Webhooks: every event is POSTed as JSON with headers `X-WD-Event`, `X-WD-Delivery` and',
      '`X-WD-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body" with your signing secret>`.',
      'Verify the signature, reject events older than five minutes, and answer 2xx within 10 seconds.',
      'Failed deliveries are retried for about a day; the same `id` may arrive more than once.',
    ].join('\n'),
  };
  doc.components.securitySchemes = {
    apiKey: {
      type: 'apiKey',
      in: 'header',
      name: 'Authorization',
      description: 'Value: `WD-Key wdk_<prefix>_<secret>`',
    },
  };
  const envelope = (type: string, data: Record<string, unknown>) => ({
    post: {
      summary: C.WEBHOOK_EVENT_LABELS[type as C.WebhookEvent],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['id', 'type', 'createdAt', 'data'],
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Event ID; use it to ignore duplicates',
                },
                type: { const: type },
                createdAt: { type: 'string', format: 'date-time' },
                data: { type: 'object', properties: data },
              },
            },
          },
        },
      },
      responses: { '2XX': { description: 'Received' } },
    },
  });
  const caseData = {
    number: { type: 'string' },
    subject: { type: 'string' },
    severity: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'] },
    status: { type: 'string' },
    url: { type: 'string', format: 'uri' },
  };
  doc.webhooks = {
    'case.created': envelope('case.created', caseData),
    'case.status_changed': envelope('case.status_changed', caseData),
    'case.message.public_created': envelope('case.message.public_created', {
      case: { type: 'object', properties: caseData },
      messageId: { type: ['string', 'null'] },
    }),
    'sla.breached': envelope('sla.breached', {
      case: { type: 'object', properties: caseData },
      metric: { type: 'string', enum: ['first_response', 'resolution'] },
    }),
    'rma.status_changed': envelope('rma.status_changed', {
      number: { type: 'string' },
      status: { type: 'string', enum: [...C.RMA_STATUSES] },
      previousStatus: { type: ['string', 'null'] },
      type: { type: 'string', enum: [...C.RMA_TYPES] },
      caseNumber: { type: 'string' },
      serialNumber: { type: 'string' },
      replacementSerial: { type: ['string', 'null'] },
      trackingNumber: { type: ['string', 'null'] },
    }),
    'advisory.published': envelope('advisory.published', {
      id: { type: 'string' },
      title: { type: 'string' },
      severity: { type: 'string' },
      cvssScore: { type: ['number', 'null'] },
      cveIds: { type: 'array', items: { type: 'string' } },
      revision: { type: 'integer' },
      url: { type: 'string', format: 'uri' },
    }),
    'entitlement.expiring': envelope('entitlement.expiring', {
      daysBefore: { type: 'integer', enum: [90, 60, 30] },
      devices: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            serialNumber: { type: 'string' },
            kind: { type: 'string' },
            tier: { type: 'string' },
            endsOn: { type: 'string', format: 'date' },
          },
        },
      },
    }),
  };
  prune(doc);
  return doc;
}
