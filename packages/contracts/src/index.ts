/**
 * @wd/contracts — the single source of truth for API request/response shapes.
 * The API validates with these schemas, the OpenAPI document is generated from them,
 * and the web app consumes the inferred types. Response schemas are allowlists:
 * a column that is not declared here can never reach a client.
 */
import { z } from 'zod';

export * from './case-lifecycle.js';
import { CASE_STATUSES } from './case-lifecycle.js';

// ---------- primitives ----------
export const Uuid = z.string().uuid();
export const IsoDateTime = z.string().datetime({ offset: true });
export const Severity = z.enum(['P1', 'P2', 'P3', 'P4']);
export type Severity = z.infer<typeof Severity>;
export const SEVERITY_LABELS: Record<Severity, string> = {
  P1: 'P1 – Critical (network down)',
  P2: 'P2 – High (severely degraded)',
  P3: 'P3 – Medium (impaired, workaround exists)',
  P4: 'P4 – Low (question / documentation)',
};
export const CaseCategory = z.enum([
  'hardware',
  'software',
  'config',
  'performance',
  'security',
  'licensing',
  'documentation',
]);
export type CaseCategory = z.infer<typeof CaseCategory>;
export const CaseStatus = z.enum(CASE_STATUSES);
export type CaseStatus = z.infer<typeof CaseStatus>;
export const Visibility = z.enum(['public', 'internal']);
export const SupportTier = z.enum(['standard', 'premium', 'mission_critical']);
export type SupportTier = z.infer<typeof SupportTier>;

/** Sanitized-on-server rich text. Length-capped to keep payloads bounded. */
const RichText = z.string().trim().min(1).max(50_000);

export const Page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof Problem>;

// ---------- identity ----------
export const RoleKey = z.enum([
  'customer_user',
  'customer_admin',
  'partner',
  'l1_engineer',
  'l2_engineer',
  'l3_engineer',
  'support_manager',
  'content_editor',
  'rma_coordinator',
  'system_admin',
]);
export type RoleKey = z.infer<typeof RoleKey>;

export const Me = z.object({
  id: Uuid,
  email: z.string().email(),
  displayName: z.string(),
  org: z.object({ id: Uuid, name: z.string(), type: z.enum(['customer', 'partner', 'internal']) }),
  roles: z.array(RoleKey),
  permissions: z.array(z.string()),
  isInternal: z.boolean(),
  locale: z.string(),
  timezone: z.string(),
});
export type Me = z.infer<typeof Me>;

export const RegistrationRequest = z.object({
  organizationName: z.string().trim().min(2).max(200),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().toLowerCase().email().max(254),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** DPDP: explicit, versioned consent to the privacy notice. */
  consentNoticeVersion: z.string().min(1),
  consentGiven: z.literal(true),
});
export type RegistrationRequest = z.infer<typeof RegistrationRequest>;

export const RegistrationSummary = z.object({
  id: Uuid,
  organizationName: z.string(),
  adminName: z.string(),
  adminEmail: z.string(),
  emailDomain: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  createdAt: IsoDateTime,
});
export type RegistrationSummary = z.infer<typeof RegistrationSummary>;

export const RegistrationDecision = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(1000).optional(),
});

// ---------- catalog / assets ----------
export const ProductFamily = z.object({
  id: Uuid,
  key: z.string(),
  name: z.string(),
  description: z.string(),
});
export type ProductFamily = z.infer<typeof ProductFamily>;

export const ProductPublic = z.object({
  id: Uuid,
  familyId: Uuid,
  sku: z.string(),
  modelName: z.string(),
  lifecycle: z.enum(['ga', 'eos_announced', 'eos', 'eol']),
});
export type ProductPublic = z.infer<typeof ProductPublic>;
/** Only for roles holding `product:read:internal_ref`. Never used for customer serializers. */
export const ProductInternal = ProductPublic.extend({ internalOemRef: z.string().nullable() });

export const AssetSummary = z.object({
  id: Uuid,
  serialNumber: z.string(),
  productId: Uuid,
  modelName: z.string(),
  familyKey: z.string(),
  siteId: Uuid.nullable(),
  siteName: z.string().nullable(),
  currentVersion: z.string().nullable(),
  entitlement: z
    .object({ tier: SupportTier, kind: z.string(), endsOn: z.string() })
    .nullable(),
});
export type AssetSummary = z.infer<typeof AssetSummary>;

export const SerialValidation = z.object({
  valid: z.boolean(),
  asset: AssetSummary.nullable(),
  reason: z.enum(['ok', 'not_found', 'not_entitled', 'expired']).optional(),
});
export type SerialValidation = z.infer<typeof SerialValidation>;

// ---------- cases ----------
export const CreateCaseRequest = z.object({
  /** Partners must state which delegated customer organisation the case is for. */
  orgId: Uuid.optional(),
  /** Staff opening a case on behalf of a customer must name the customer contact. */
  requesterId: Uuid.optional(),
  serialNumber: z.string().trim().min(3).max(64),
  softwareVersion: z.string().trim().max(64).optional(),
  severity: Severity,
  category: CaseCategory,
  subject: z.string().trim().min(8).max(200),
  description: RichText,
  stepsTried: z.string().trim().max(10_000).optional(),
  businessImpact: z.string().trim().max(5_000).optional(),
  /** Already-uploaded (tus) upload ids to bind to the first message. */
  uploadIds: z.array(z.string().regex(/^[a-f0-9]{32}$/)).max(20).default([]),
});
export type CreateCaseRequest = z.infer<typeof CreateCaseRequest>;

export const SlaClockView = z.object({
  metric: z.enum(['first_response', 'update', 'restoration', 'resolution']),
  dueAt: IsoDateTime,
  metAt: IsoDateTime.nullable(),
  breachedAt: IsoDateTime.nullable(),
  paused: z.boolean(),
  /** Business seconds remaining at the time of the response (negative when overdue). */
  remainingSeconds: z.number().int(),
  /** 0–100+, share of the budget consumed. */
  percentElapsed: z.number(),
});
export type SlaClockView = z.infer<typeof SlaClockView>;

export const CaseSummary = z.object({
  id: Uuid,
  number: z.string(),
  subject: z.string(),
  severity: Severity,
  category: CaseCategory,
  status: CaseStatus,
  supportLevel: z.number().int().min(1).max(4),
  orgId: Uuid,
  orgName: z.string(),
  requesterName: z.string(),
  assigneeName: z.string().nullable(),
  serialNumber: z.string().nullable(),
  modelName: z.string().nullable(),
  openedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  nextSla: SlaClockView.nullable(),
});
export type CaseSummary = z.infer<typeof CaseSummary>;

export const AttachmentView = z.object({
  id: Uuid,
  fileName: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string().nullable(),
  scanStatus: z.enum(['pending', 'clean', 'infected', 'rejected', 'error']),
  secretsMasked: z.boolean(),
  maskedCount: z.number().int(),
  visibility: Visibility,
  createdAt: IsoDateTime,
});
export type AttachmentView = z.infer<typeof AttachmentView>;

export const MessageView = z.object({
  id: Uuid,
  author: z.object({ id: Uuid.nullable(), name: z.string(), isStaff: z.boolean() }),
  visibility: Visibility,
  bodyHtml: z.string(),
  source: z.enum(['web', 'email', 'api', 'system']),
  createdAt: IsoDateTime,
  attachments: z.array(AttachmentView),
});
export type MessageView = z.infer<typeof MessageView>;

export const CaseEventView = z.object({
  id: Uuid,
  type: z.string(),
  data: z.record(z.unknown()),
  actorName: z.string().nullable(),
  at: IsoDateTime,
});
export type CaseEventView = z.infer<typeof CaseEventView>;

export const CaseDetail = CaseSummary.extend({
  description: z.string(),
  stepsTried: z.string().nullable(),
  businessImpact: z.string().nullable(),
  softwareVersion: z.string().nullable(),
  tier: SupportTier.nullable(),
  sla: z.array(SlaClockView),
  messages: z.array(MessageView),
  events: z.array(CaseEventView),
  csat: z.object({ score: z.number().int(), comment: z.string().nullable() }).nullable(),
  version: z.number().int(),
  allowedTransitions: z.array(CaseStatus),
  can: z.object({
    reply: z.boolean(),
    internalNote: z.boolean(),
    escalate: z.boolean(),
    customerEscalate: z.boolean(),
    assign: z.boolean(),
    submitCsat: z.boolean(),
  }),
});
export type CaseDetail = z.infer<typeof CaseDetail>;

export const ReplyRequest = z.object({
  visibility: Visibility.default('public'),
  body: RichText,
  uploadIds: z.array(z.string().regex(/^[a-f0-9]{32}$/)).max(20).default([]),
  /** Optional status change applied atomically with the reply (e.g. reply + Awaiting Customer). */
  setStatus: CaseStatus.optional(),
});
export type ReplyRequest = z.infer<typeof ReplyRequest>;

export const TransitionRequest = z.object({
  to: CaseStatus,
  note: z.string().trim().max(5_000).optional(),
});
export type TransitionRequest = z.infer<typeof TransitionRequest>;

export const EscalateRequest = z.object({
  justification: z.string().trim().min(20).max(5_000),
});
export const AssignRequest = z.object({ assigneeId: Uuid.nullable() });

export const CsatRequest = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2_000).optional(),
});
export type CsatRequest = z.infer<typeof CsatRequest>;

export const CaseListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['open', 'closed', 'all']).default('open'),
  severity: Severity.optional(),
  q: z.string().trim().max(200).optional(),
  scope: z.enum(['mine', 'org', 'queue', 'assigned']).optional(),
});
export type CaseListQuery = z.infer<typeof CaseListQuery>;

export const UploadPolicy = z.object({
  endpoint: z.string(),
  maxBytes: z.number().int(),
  chunkBytes: z.number().int(),
  allowedExtensions: z.array(z.string()),
});

export const SignedUrl = z.object({ url: z.string().url(), expiresAt: IsoDateTime });

export const WarrantyLookupRequest = z.object({
  serialNumber: z.string().trim().min(3).max(64),
  captchaToken: z.string().min(1).max(4000),
});
export const WarrantyLookupResponse = z.object({
  found: z.boolean(),
  modelName: z.string().nullable(),
  coverage: z
    .array(z.object({ kind: z.string(), tier: SupportTier, endsOn: z.string(), active: z.boolean() }))
    .default([]),
});
