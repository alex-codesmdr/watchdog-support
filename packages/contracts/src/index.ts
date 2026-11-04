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
  entitlement: z.object({ tier: SupportTier, kind: z.string(), endsOn: z.string() }).nullable(),
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
  uploadIds: z
    .array(z.string().regex(/^[a-f0-9]{32}$/))
    .max(20)
    .default([]),
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
  assigneeId: Uuid.nullable(),
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
  data: z.record(z.string(), z.unknown()),
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
  uploadIds: z
    .array(z.string().regex(/^[a-f0-9]{32}$/))
    .max(20)
    .default([]),
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
    .array(
      z.object({ kind: z.string(), tier: SupportTier, endsOn: z.string(), active: z.boolean() }),
    )
    .default([]),
});

// ---------- SLA reporting ----------
export const SlaReportQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export const SlaComplianceRow = z.object({
  tier: SupportTier,
  severity: Severity,
  metric: z.enum(['first_response', 'update', 'restoration', 'resolution']),
  total: z.number().int(),
  met: z.number().int(),
  breached: z.number().int(),
  running: z.number().int(),
  compliancePct: z.number().nullable(),
});
export const SlaBreachRow = z.object({
  caseNumber: z.string(),
  subject: z.string(),
  orgName: z.string(),
  severity: Severity,
  tier: SupportTier,
  metric: z.enum(['first_response', 'update', 'restoration', 'resolution']),
  dueAt: IsoDateTime,
  breachedAt: IsoDateTime,
  metAt: IsoDateTime.nullable(),
  assigneeName: z.string().nullable(),
  supportLevel: z.number().int(),
});
export const SlaReport = z.object({
  from: z.string(),
  to: z.string(),
  overallCompliancePct: z.number().nullable(),
  rows: z.array(SlaComplianceRow),
  breaches: z.array(SlaBreachRow),
});
export type SlaReport = z.infer<typeof SlaReport>;

// ---------- knowledge base ----------
export const KbType = z.enum([
  'howto',
  'troubleshooting',
  'config_guide',
  'faq',
  'known_issue',
  'best_practice',
]);
export type KbType = z.infer<typeof KbType>;
export const KB_TYPE_LABELS: Record<KbType, string> = {
  howto: 'How-to',
  troubleshooting: 'Troubleshooting',
  config_guide: 'Configuration guide',
  faq: 'FAQ',
  known_issue: 'Known issue',
  best_practice: 'Best practice',
};
export const KbVisibility = z.enum(['public', 'registered', 'partner', 'internal']);
export const KbState = z.enum(['draft', 'review', 'published', 'archived']);

export const KbSearchQuery = z.object({
  q: z.string().trim().max(200).default(''),
  type: KbType.optional(),
  family: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).max(50).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export const KbHit = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  type: KbType,
  familyKey: z.string().nullable(),
  familyName: z.string().nullable(),
  publishedAt: IsoDateTime.nullable(),
  /** Matched text with <mark> highlights (HTML-escaped otherwise). */
  snippet: z.string(),
});
export type KbHit = z.infer<typeof KbHit>;
export const KbSearchResult = z.object({
  items: z.array(KbHit),
  total: z.number().int(),
  page: z.number().int(),
  facets: z.object({
    type: z.record(z.string(), z.number()),
    family: z.record(z.string(), z.number()),
  }),
  didYouMean: z.string().nullable(),
  tookMs: z.number(),
});
export type KbSearchResult = z.infer<typeof KbSearchResult>;

export const KbArticleView = z.object({
  id: Uuid,
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  type: KbType,
  visibility: KbVisibility,
  state: KbState,
  family: z.object({ key: z.string(), name: z.string() }).nullable(),
  products: z.array(z.object({ sku: z.string(), modelName: z.string() })),
  firmwareVersions: z.array(z.string()),
  bodyHtml: z.string(),
  version: z.number().int(),
  publishedAt: IsoDateTime.nullable(),
  updatedAt: IsoDateTime,
  helpful: z.number().int(),
  notHelpful: z.number().int(),
  related: z.array(z.object({ slug: z.string(), title: z.string(), type: KbType })),
});
export type KbArticleView = z.infer<typeof KbArticleView>;

export const KbFeedbackRequest = z.object({
  helpful: z.boolean(),
  comment: z.string().trim().max(2000).optional(),
});

export const KbDraftRequest = z.object({
  title: z.string().trim().min(8).max(200),
  summary: z.string().trim().max(500),
  bodyMd: z.string().max(200_000),
  type: KbType,
  visibility: KbVisibility.default('public'),
  familyKey: z.string().max(40).nullable().optional(),
  productSkus: z.array(z.string().max(40)).max(50).default([]),
  firmwareVersions: z.array(z.string().trim().max(40)).max(50).default([]),
  changeNote: z.string().trim().max(500).optional(),
});
export type KbDraftRequest = z.infer<typeof KbDraftRequest>;

export const KbEditorRow = z.object({
  id: Uuid,
  slug: z.string(),
  title: z.string(),
  type: KbType,
  visibility: KbVisibility,
  state: KbState,
  currentVersion: z.number().int(),
  publishedVersion: z.number().int().nullable(),
  updatedAt: IsoDateTime,
  authorName: z.string(),
});
export const KbEditorArticle = KbEditorRow.extend({
  summary: z.string(),
  bodyMd: z.string(),
  familyKey: z.string().nullable(),
  productSkus: z.array(z.string()),
  firmwareVersions: z.array(z.string()),
  previewHtml: z.string(),
  sourceCaseNumber: z.string().nullable(),
});
export type KbEditorArticle = z.infer<typeof KbEditorArticle>;

// ---------- sites, assets, renewals, import ----------
export const SiteView = z.object({
  id: Uuid,
  orgId: Uuid,
  name: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  pincode: z.string().nullable(),
  assetCount: z.number().int(),
});
export type SiteView = z.infer<typeof SiteView>;
export const SiteRequest = z.object({
  orgId: Uuid.optional(),
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, 'Enter a 6-digit PIN code')
    .optional()
    .or(z.literal('').transform(() => undefined)),
});
export const AssetUpdateRequest = z.object({ siteId: Uuid.nullable() });
export const RenewalRequestBody = z.object({
  desiredTier: SupportTier.optional(),
  note: z.string().trim().max(2000).optional(),
});
export const RenewalView = z.object({
  id: Uuid,
  assetId: Uuid,
  serialNumber: z.string(),
  status: z.enum(['requested', 'quoted', 'won', 'lost', 'cancelled']),
  desiredTier: SupportTier.nullable(),
  createdAt: IsoDateTime,
});
export type RenewalView = z.infer<typeof RenewalView>;

export const ImportRowResult = z.object({
  row: z.number().int(),
  serialNumber: z.string().nullable(),
  status: z.enum(['created', 'updated', 'unchanged', 'error']),
  messages: z.array(z.string()),
});
export const ImportReport = z.object({
  id: Uuid,
  fileName: z.string(),
  dryRun: z.boolean(),
  totalRows: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  failed: z.number().int(),
  rows: z.array(ImportRowResult),
});
export type ImportReport = z.infer<typeof ImportReport>;
export const IMPORT_COLUMNS = [
  'organisation',
  'serial_number',
  'sku',
  'site',
  'mac',
  'purchase_date',
  'software_version',
  'coverage_kind',
  'coverage_tier',
  'coverage_start',
  'coverage_end',
  'contract_ref',
] as const;

// ---------- download centre ----------
export const ReleaseKind = z.enum([
  'firmware',
  'software',
  'release_notes',
  'mib',
  'document',
  'tool',
]);
export type ReleaseKind = z.infer<typeof ReleaseKind>;
export const RELEASE_KIND_LABELS: Record<ReleaseKind, string> = {
  firmware: 'Firmware',
  software: 'Software',
  release_notes: 'Release notes',
  mib: 'MIBs',
  document: 'Documents',
  tool: 'Tools',
};
export const ReleaseVisibility = z.enum(['public', 'registered', 'entitled', 'internal']);
export type ReleaseVisibility = z.infer<typeof ReleaseVisibility>;
export const ReleaseStatus = z.enum(['draft', 'published', 'deprecated', 'withdrawn']);
/** What the current visitor can do with a release's files. */
export const ReleaseAccess = z.enum(['download', 'sign_in', 'entitlement_required']);
export const ReleaseFileView = z.object({
  id: Uuid,
  fileName: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  ready: z.boolean(),
});
export const ReleaseView = z.object({
  id: Uuid,
  family: z.object({ key: z.string(), name: z.string() }),
  kind: ReleaseKind,
  title: z.string(),
  version: z.string(),
  visibility: ReleaseVisibility,
  status: ReleaseStatus,
  recommended: z.boolean(),
  releasedOn: z.string().nullable(),
  access: ReleaseAccess,
  products: z.array(z.object({ sku: z.string(), modelName: z.string() })),
  files: z.array(ReleaseFileView),
  eula: z
    .object({ id: Uuid, title: z.string(), version: z.string(), accepted: z.boolean() })
    .nullable(),
  notesHtml: z.string().optional(),
});
export type ReleaseView = z.infer<typeof ReleaseView>;
export const ReleaseListQuery = z.object({
  family: z.string().max(40).optional(),
  kind: ReleaseKind.optional(),
  q: z.string().trim().max(100).optional(),
});
export const ReleaseDraftRequest = z.object({
  familyKey: z.string().max(40),
  kind: ReleaseKind,
  title: z.string().trim().min(3).max(200),
  version: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,40}$/, 'Use letters, digits, dots, hyphens or underscores'),
  visibility: ReleaseVisibility,
  recommended: z.boolean().default(false),
  releasedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  notesMd: z.string().max(100_000).default(''),
  productSkus: z.array(z.string().max(40)).max(100).default([]),
  eulaVersion: z.string().max(40).nullable().optional(),
});
export type ReleaseDraftRequest = z.infer<typeof ReleaseDraftRequest>;
export const ReleaseStatusRequest = z.object({ status: ReleaseStatus });
export const DownloadLink = z.object({
  url: z.string(),
  expiresAt: IsoDateTime,
  fileName: z.string(),
  sha256: z.string(),
});
export type DownloadLink = z.infer<typeof DownloadLink>;
