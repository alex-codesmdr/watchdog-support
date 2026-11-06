/**
 * Kysely table types. Hand-maintained alongside migrations in Phase 2; `kysely-codegen` replaces
 * this file once CI has a database service (see docs/runbooks/development.md).
 * NOTE: product.internal_oem_ref is deliberately absent — the app role has no column privilege on it.
 */
import type { ColumnType, Generated } from 'kysely';

type Ts = ColumnType<Date, Date | string | undefined, Date | string>;
type TsNull = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type Json<T = Record<string, unknown>> = ColumnType<T, string | T, string | T>;

export interface OrganizationT {
  id: Generated<string>;
  name: string;
  org_type: 'customer' | 'partner' | 'internal';
  status: Generated<'pending' | 'active' | 'suspended' | 'rejected'>;
  gstin: string | null;
  data_region: Generated<string>;
  created_at: Ts;
  updated_at: Ts;
}
export interface AppUserT {
  id: Generated<string>;
  org_id: string;
  kc_subject: string | null;
  email: string;
  display_name: string;
  phone: string | null;
  locale: Generated<string>;
  timezone: Generated<string>;
  status: Generated<'invited' | 'active' | 'disabled'>;
  is_service: Generated<boolean>;
  last_login_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
}
export interface UserRoleT {
  user_id: string;
  role_key: string;
  granted_by: string | null;
  granted_at: Ts;
}
export interface RoleT {
  key: string;
  name: string;
  is_internal: boolean;
}
export interface RolePermissionT {
  role_key: string;
  permission_key: string;
}
export interface RegistrationT {
  id: Generated<string>;
  org_id: string;
  admin_name: string;
  admin_email: string;
  phone: string | null;
  email_domain: string;
  status: Generated<'pending' | 'approved' | 'rejected'>;
  decided_by: string | null;
  decided_at: TsNull;
  reason: string | null;
  created_at: Ts;
}
export interface AuditLogT {
  seq: Generated<string>;
  at: Ts;
  org_id: string | null;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  diff: Json;
  ip: string | null;
  request_id: string | null;
  prev_hash: Generated<Buffer | null>;
  hash: Generated<Buffer>;
}
export interface OutboxEventT {
  id: Generated<string>;
  topic: string;
  org_id: string | null;
  payload: Json;
  created_at: Ts;
  available_at: Ts;
  published_at: TsNull;
  attempts: Generated<number>;
  last_error: string | null;
}
export interface ProductFamilyT {
  id: Generated<string>;
  key: string;
  name: string;
  description: string;
  sort_order: number;
}
export interface ProductT {
  id: Generated<string>;
  family_id: string;
  sku: string;
  model_name: string;
  description: string;
  lifecycle: 'ga' | 'eos_announced' | 'eos' | 'eol';
  eos_date: TsNull;
  eol_date: TsNull;
  specs: Json;
  created_at: Ts;
}
export interface SiteT {
  id: Generated<string>;
  org_id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  created_at: Ts;
}
export interface AssetT {
  id: Generated<string>;
  org_id: string;
  site_id: string | null;
  product_id: string;
  serial_number: string;
  mac: string | null;
  purchase_date: TsNull;
  current_version: string | null;
  retired_at: TsNull;
  created_at: Ts;
}
export interface EntitlementT {
  id: Generated<string>;
  org_id: string;
  asset_id: string;
  kind: 'warranty' | 'amc' | 'subscription';
  tier: 'standard' | 'premium' | 'mission_critical';
  starts_on: ColumnType<string, string, string>;
  ends_on: ColumnType<string, string, string>;
  contract_ref: string | null;
  created_at: Ts;
}
export interface BusinessCalendarT {
  id: Generated<string>;
  key: string;
  name: string;
  time_zone: string;
  twenty_four_seven: boolean;
  weekly: Json<Record<string, Array<[string, string]>>>;
}
export interface CalendarHolidayT {
  calendar_id: string;
  day: ColumnType<string, string, string>;
  name: string;
}
export interface SlaPolicyT {
  id: Generated<string>;
  tier: string;
  version: number;
  calendar_id: string;
  active: boolean;
}
export interface SlaTargetT {
  policy_id: string;
  severity: string;
  first_response_min: number;
  update_every_min: number;
  restoration_min: number | null;
  resolution_min: number;
  round_the_clock: boolean;
}
export interface QueueT {
  id: Generated<string>;
  key: string;
  name: string;
  support_level: number;
}
export interface SupportCaseT {
  id: Generated<string>;
  org_id: string;
  number: Generated<string>;
  requester_id: string;
  created_by: string;
  asset_id: string | null;
  entitlement_id: string | null;
  tier: string | null;
  severity: 'P1' | 'P2' | 'P3' | 'P4';
  category: string;
  status: Generated<string>;
  support_level: Generated<number>;
  assignee_id: string | null;
  queue_id: string | null;
  sla_policy_id: string | null;
  subject: string;
  description_html: string;
  steps_tried: string | null;
  business_impact: string | null;
  software_version: string | null;
  opened_at: Ts;
  first_responded_at: TsNull;
  resolved_at: TsNull;
  closed_at: TsNull;
  customer_escalated_at: TsNull;
  merged_into_id: string | null;
  version: Generated<number>;
  updated_at: Ts;
}
export interface CaseMessageT {
  id: Generated<string>;
  org_id: Generated<string>; // set by trigger from the case
  case_id: string;
  author_id: string | null;
  author_is_staff: boolean;
  visibility: 'public' | 'internal';
  body_html: string;
  source: 'web' | 'email' | 'api' | 'system';
  email_message_id: string | null;
  created_at: Ts;
}
export interface UploadT {
  id: string;
  org_id: string;
  user_id: string;
  file_name: string;
  size_bytes: ColumnType<string, number | string, number | string>;
  completed: Generated<boolean>;
  bound_at: TsNull;
  created_at: Ts;
}
export interface CaseAttachmentT {
  id: Generated<string>;
  org_id: Generated<string>;
  case_id: string;
  message_id: string | null;
  upload_id: string;
  file_name: string;
  content_type: string | null;
  size_bytes: ColumnType<string, number | string, number | string>;
  sha256: string | null;
  quarantine_key: string;
  object_key: string | null;
  original_key: string | null;
  scan_status: Generated<'pending' | 'clean' | 'infected' | 'rejected' | 'error'>;
  scan_detail: string | null;
  secrets_masked: Generated<boolean>;
  masked_count: Generated<number>;
  visibility: 'public' | 'internal';
  uploaded_by: string;
  created_at: Ts;
}
export interface CaseEventT {
  id: Generated<string>;
  org_id: Generated<string>;
  case_id: string;
  type: string;
  visibility: Generated<'public' | 'internal'>;
  data: Json;
  actor_id: string | null;
  at: Ts;
}
export interface SlaClockT {
  id: Generated<string>;
  org_id: Generated<string>;
  case_id: string;
  metric: 'first_response' | 'update' | 'restoration' | 'resolution';
  target_minutes: number;
  calendar: Json<import('@wd/sla-time').BusinessCalendar>;
  started_at: Ts;
  due_at: Ts;
  paused_ms: ColumnType<string, number | string | undefined, number | string>;
  paused_at: TsNull;
  met_at: TsNull;
  breached_at: TsNull;
  last_warn_pct: Generated<number>;
}
export interface CsatResponseT {
  id: Generated<string>;
  org_id: Generated<string>;
  case_id: string;
  user_id: string;
  score: number;
  comment: string | null;
  created_at: Ts;
}
export interface NotificationT {
  id: Generated<string>;
  org_id: string | null;
  user_id: string | null;
  channel: 'email' | 'sms' | 'whatsapp' | 'in_app';
  recipient: string;
  template_key: string;
  payload: Json;
  status: Generated<'queued' | 'sent' | 'failed' | 'suppressed'>;
  error: string | null;
  created_at: Ts;
  sent_at: TsNull;
}
export interface InboundEmailHoldT {
  id: Generated<string>;
  message_id: string | null;
  from_addr: string;
  subject: string | null;
  reason: string;
  raw_key: string | null;
  case_id: string | null;
  created_at: Ts;
  resolved_at: TsNull;
}
export interface PartnerDelegationT {
  id: Generated<string>;
  partner_org_id: string;
  customer_org_id: string;
  scope: string[];
  revoked_at: TsNull;
  expires_at: TsNull;
}

export interface EscalationRuleT {
  id: Generated<string>;
  tier: string | null;
  severity: string | null;
  metric: string | null;
  threshold: number;
  action: 'notify_assignee' | 'notify_managers' | 'notify_matrix' | 'escalate_level';
  active: boolean;
}
export interface EscalationContactT {
  id: Generated<string>;
  tier: string | null;
  level: number;
  region: string | null;
  name: string;
  title: string;
  email: string;
  phone: string | null;
  active: boolean;
}

export interface KbArticleT {
  id: Generated<string>;
  slug: string;
  type: string;
  visibility: Generated<string>;
  state: Generated<string>;
  family_id: string | null;
  current_version: Generated<number>;
  published_version: number | null;
  title: string | null;
  summary: string | null;
  search_vec: unknown;
  firmware_versions: Generated<string[]>;
  views: Generated<number>;
  helpful: Generated<number>;
  not_helpful: Generated<number>;
  source_case_id: string | null;
  created_by: string;
  created_at: Ts;
  updated_at: Ts;
  published_at: TsNull;
}
export interface KbVersionT {
  article_id: string;
  version: number;
  title: string;
  summary: string;
  body_md: string;
  author_id: string;
  reviewer_id: string | null;
  change_note: string | null;
  created_at: Ts;
}
export interface KbArticleProductT {
  article_id: string;
  product_id: string;
}
export interface KbFeedbackT {
  id: Generated<string>;
  article_id: string;
  user_id: string | null;
  helpful: boolean;
  comment: string | null;
  created_at: Ts;
}

export interface RenewalRequestT {
  id: Generated<string>;
  org_id: string;
  asset_id: string;
  entitlement_id: string | null;
  requested_by: string;
  desired_tier: string | null;
  note: string | null;
  status: Generated<string>;
  created_at: Ts;
}
export interface ApiKeyT {
  id: Generated<string>;
  org_id: string;
  name: string;
  prefix: string;
  secret_hash: string;
  scopes: ColumnType<string[], string[], string[]>;
  created_by: string;
  expires_at: TsNull;
  last_used_at: TsNull;
  revoked_at: TsNull;
  created_at: Ts;
}
export interface WebhookT {
  id: Generated<string>;
  org_id: string;
  url: string;
  events: ColumnType<string[], string[], string[]>;
  secret_enc: string;
  active: Generated<boolean>;
  disabled_reason: string | null;
  consecutive_failures: Generated<number>;
  created_by: string;
  created_at: Ts;
}
export interface WebhookDeliveryT {
  id: Generated<string>;
  webhook_id: string;
  org_id: string;
  event_id: string;
  event_type: string;
  body: string;
  status: Generated<'pending' | 'succeeded' | 'failed'>;
  attempts: Generated<number>;
  last_status: number | null;
  last_error: string | null;
  next_attempt_at: Ts;
  delivered_at: TsNull;
  created_at: Ts;
}
export interface AdvisoryT {
  id: Generated<string>;
  wd_id: Generated<string>;
  title: string;
  summary: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  cvss_score: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  cvss_vector: string | null;
  cve_ids: ColumnType<string[], string[] | undefined, string[]>;
  body_md: Generated<string>;
  body_html: Generated<string>;
  workaround_md: Generated<string>;
  workaround_html: Generated<string>;
  status: Generated<'draft' | 'published' | 'withdrawn'>;
  revision: Generated<number>;
  revision_note: string | null;
  created_by: string;
  published_at: TsNull;
  updated_at: Ts;
  created_at: Ts;
}
export interface AdvisoryAffectedT {
  id: Generated<string>;
  advisory_id: string;
  product_id: string;
  affected_versions: string;
  fixed_version: string | null;
}
export interface AdvisoryInternalT {
  advisory_id: string;
  notes: Generated<string>;
}
export interface AdvisorySubscriptionT {
  user_id: string;
  family_ids: ColumnType<string[], string[] | undefined, string[]>;
  min_severity: Generated<'critical' | 'high' | 'medium' | 'low' | 'informational'>;
  updated_at: Ts;
}
export interface RmaT {
  id: Generated<string>;
  number: Generated<string>;
  org_id: string;
  case_id: string;
  asset_id: string;
  type: 'standard' | 'advance';
  status: Generated<
    | 'requested'
    | 'approved'
    | 'return_in_transit'
    | 'received'
    | 'replacement_shipped'
    | 'closed'
    | 'rejected'
    | 'cancelled'
  >;
  fault_description: string;
  contact_name: string;
  contact_phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  replacement_serial: string | null;
  replacement_asset_id: string | null;
  outbound_courier: string | null;
  outbound_tracking: string | null;
  inbound_courier: string | null;
  inbound_tracking: string | null;
  shipped_at: TsNull;
  received_at: TsNull;
  requested_by: string;
  version: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
}
export interface RmaEventT {
  id: Generated<string>;
  rma_id: string;
  org_id: string;
  from_status: string | null;
  to_status: string;
  actor_id: string | null;
  note: string | null;
  at: Ts;
}
export interface IdempotencyKeyT {
  user_id: string;
  key: string;
  request_hash: string;
  case_id: string | null;
  created_at: Ts;
}
export interface EulaT {
  id: Generated<string>;
  version: string;
  title: string;
  body_html: string;
  created_at: Ts;
}
export interface SoftwareReleaseT {
  id: Generated<string>;
  family_id: string;
  kind: 'firmware' | 'software' | 'release_notes' | 'mib' | 'document' | 'tool';
  title: string;
  version: string;
  visibility: Generated<'public' | 'registered' | 'entitled' | 'internal'>;
  status: Generated<'draft' | 'published' | 'deprecated' | 'withdrawn'>;
  recommended: Generated<boolean>;
  released_on: TsNull;
  notes_md: Generated<string>;
  notes_html: Generated<string>;
  eula_id: string | null;
  created_by: string;
  created_at: Ts;
  published_at: TsNull;
}
export interface ReleaseProductT {
  release_id: string;
  product_id: string;
}
export interface ReleaseFileT {
  id: Generated<string>;
  release_id: string;
  file_name: string;
  size_bytes: ColumnType<string, number | string, number | string>;
  sha256: string;
  quarantine_key: string | null;
  object_key: string | null;
  scan_status: Generated<'pending' | 'clean' | 'infected'>;
  created_at: Ts;
}
export interface EulaAcceptanceT {
  user_id: string;
  eula_id: string;
  accepted_at: Ts;
}
export interface DownloadEventT {
  id: Generated<string>;
  file_id: string;
  user_id: string | null;
  org_id: string | null;
  ip: string | null;
  at: Ts;
}
export interface EntitlementReminderT {
  entitlement_id: string;
  days_before: number;
  sent_at: Ts;
}
export interface AssetImportT {
  id: Generated<string>;
  uploaded_by: string;
  file_name: string;
  dry_run: boolean;
  total_rows: number;
  created: number;
  updated: number;
  failed: number;
  report: Json<unknown[]>;
  created_at: Ts;
}

export interface AnnouncementT {
  id: Generated<string>;
  title: string;
  body: Generated<string>;
  link_url: string | null;
  tone: Generated<'info' | 'maintenance' | 'incident'>;
  audience: Generated<'everyone' | 'customers' | 'staff'>;
  starts_at: Ts;
  ends_at: TsNull;
  created_by: string;
  updated_at: Ts;
  created_at: Ts;
}
export interface SavedReplyT {
  id: Generated<string>;
  owner_id: string | null;
  title: string;
  body: string;
  created_by: string;
  updated_at: Ts;
  created_at: Ts;
}

export interface RoutingRuleT {
  id: Generated<string>;
  name: string;
  position: number;
  enabled: Generated<boolean>;
  severities: string[] | null;
  categories: string[] | null;
  family_ids: string[] | null;
  org_ids: string[] | null;
  queue_id: string | null;
  assignee_ids: Generated<string[]>;
  created_by: string;
  updated_at: Ts;
  created_at: Ts;
}

export interface PortalSettingT {
  key: string;
  value: unknown;
  updated_by: string | null;
  updated_at: Generated<Date>;
}

export interface CaseTimeEntryT {
  id: Generated<string>;
  org_id: Generated<string>;
  case_id: string;
  user_id: string;
  minutes: number;
  note: Generated<string>;
  worked_on: ColumnType<string, string | undefined, string>;
  created_at: Ts;
}
export interface SavedViewT {
  id: Generated<string>;
  owner_id: string;
  name: string;
  params: unknown;
  created_at: Ts;
}

export interface CaseJiraLinkT {
  case_id: string;
  org_id: Generated<string>;
  issue_key: string;
  issue_url: string;
  status: string;
  category: string;
  linked_by: string;
  synced_at: Generated<Date>;
  created_at: Ts;
}

export interface DB {
  case_jira_link: CaseJiraLinkT;
  case_time_entry: CaseTimeEntryT;
  saved_view: SavedViewT;
  portal_setting: PortalSettingT;
  routing_rule: RoutingRuleT;
  announcement: AnnouncementT;
  saved_reply: SavedReplyT;
  renewal_request: RenewalRequestT;
  entitlement_reminder: EntitlementReminderT;
  eula: EulaT;
  idempotency_key: IdempotencyKeyT;
  rma: RmaT;
  advisory: AdvisoryT;
  api_key: ApiKeyT;
  webhook: WebhookT;
  webhook_delivery: WebhookDeliveryT;
  advisory_affected: AdvisoryAffectedT;
  advisory_internal: AdvisoryInternalT;
  advisory_subscription: AdvisorySubscriptionT;
  rma_event: RmaEventT;
  software_release: SoftwareReleaseT;
  release_product: ReleaseProductT;
  release_file: ReleaseFileT;
  eula_acceptance: EulaAcceptanceT;
  download_event: DownloadEventT;
  asset_import: AssetImportT;
  kb_article: KbArticleT;
  kb_version: KbVersionT;
  kb_article_product: KbArticleProductT;
  kb_feedback: KbFeedbackT;
  escalation_rule: EscalationRuleT;
  escalation_contact: EscalationContactT;
  organization: OrganizationT;
  app_user: AppUserT;
  user_role: UserRoleT;
  role: RoleT;
  role_permission: RolePermissionT;
  registration: RegistrationT;
  audit_log: AuditLogT;
  outbox_event: OutboxEventT;
  product_family: ProductFamilyT;
  product: ProductT;
  site: SiteT;
  asset: AssetT;
  entitlement: EntitlementT;
  business_calendar: BusinessCalendarT;
  calendar_holiday: CalendarHolidayT;
  sla_policy: SlaPolicyT;
  sla_target: SlaTargetT;
  queue: QueueT;
  support_case: SupportCaseT;
  case_message: CaseMessageT;
  upload: UploadT;
  case_attachment: CaseAttachmentT;
  case_event: CaseEventT;
  sla_clock: SlaClockT;
  csat_response: CsatResponseT;
  notification: NotificationT;
  inbound_email_hold: InboundEmailHoldT;
  partner_delegation: PartnerDelegationT;
}
