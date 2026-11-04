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

export interface DB {
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
