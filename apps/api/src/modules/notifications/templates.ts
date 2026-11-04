import mjml2html from 'mjml';

/**
 * Transactional email templates (MJML → responsive HTML + plain-text part).
 * Strings are per-locale; Phase 2 ships English, Hindi lands in Phase 4 with the same keys.
 * All interpolated values are HTML-escaped; only WatchDog branding appears anywhere.
 */
export type TemplateKey =
  | 'registration_received'
  | 'registration_approved'
  | 'registration_rejected'
  | 'staff_registration_pending'
  | 'case_created'
  | 'case_reply'
  | 'case_customer_reply'
  | 'case_status'
  | 'case_resolved'
  | 'case_customer_escalated';

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

type Vars = Record<string, string | number | null | undefined>;
type Strings = Record<
  TemplateKey,
  { subject: string; heading: string; body: string; cta?: string }
>;

const EN: Strings = {
  registration_received: {
    subject: 'We received your WatchDog Support registration',
    heading: 'Thanks for registering, {{name}}',
    body: 'We have received the registration for <b>{{org}}</b>. Our team verifies every new organisation, usually within one business day. You will get an email to set your password and multi-factor authentication once it is approved.',
  },
  registration_approved: {
    subject: 'Your WatchDog Support account is approved',
    heading: 'Welcome to WatchDog Support',
    body: '<b>{{org}}</b> is now active. A separate email will ask you to verify your address, set a password and enrol an authenticator app. After that you can open cases, track SLAs and manage your team.',
    cta: 'Go to WatchDog Support',
  },
  registration_rejected: {
    subject: 'Your WatchDog Support registration',
    heading: 'We could not approve this registration',
    body: 'We were unable to verify the registration for <b>{{org}}</b>. If you believe this is a mistake, reply to this email or contact your WatchDog account manager.',
  },
  staff_registration_pending: {
    subject: '[Action] New organisation awaiting approval: {{org}}',
    heading: 'New registration',
    body: '<b>{{org}}</b> registered with admin {{name}} ({{email}}). Review it in the admin console.',
    cta: 'Review registrations',
  },
  case_created: {
    subject: '[{{number}}] Case opened: {{subject}}',
    heading: 'Case {{number}} is open',
    body: 'We have logged your <b>{{severity}}</b> case "{{subject}}".<br>First response is due by <b>{{firstResponseDue}}</b> (IST). You can reply to this email to add information.',
    cta: 'View case',
  },
  case_reply: {
    subject: '[{{number}}] New update from WatchDog Support',
    heading: 'Update on case {{number}}',
    body: '{{author}} wrote:<br><br>{{excerpt}}',
    cta: 'View and reply',
  },
  case_customer_reply: {
    subject: '[{{number}}] Customer replied: {{subject}}',
    heading: 'Customer update on {{number}}',
    body: '{{author}} ({{org}}) wrote:<br><br>{{excerpt}}',
    cta: 'Open in workspace',
  },
  case_status: {
    subject: '[{{number}}] Status: {{status}}',
    heading: 'Case {{number}} is now {{status}}',
    body: 'The status of "{{subject}}" changed from {{from}} to <b>{{status}}</b>.',
    cta: 'View case',
  },
  case_resolved: {
    subject: '[{{number}}] Resolved – how did we do?',
    heading: 'Case {{number}} is resolved',
    body: 'We have marked "{{subject}}" as resolved. If the problem persists, just reply and the case will reopen.<br><br>Please take 10 seconds to rate the support you received.',
    cta: 'Rate this case',
  },
  case_customer_escalated: {
    subject: '[ESCALATION] {{number}} – {{org}}',
    heading: 'Customer escalation on {{number}}',
    body: '{{org}} escalated case "{{subject}}" ({{severity}}). Review the justification on the case and respond per the escalation matrix.',
    cta: 'Open case',
  },
};

const LOCALES: Record<string, Strings> = { en: EN };

const esc = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
/** `{{x}}` is escaped; values ending in `Html` are trusted (pre-sanitised server HTML). */
const fill = (tpl: string, v: Vars) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
    k.endsWith('Html') ? String(v[k] ?? '') : esc(v[k]),
  );

const cache = new Map<string, Rendered>();

export async function render(
  key: TemplateKey,
  vars: Vars & { url?: string },
  locale = 'en',
): Promise<Rendered> {
  const s = (LOCALES[locale.slice(0, 2)] ?? EN)[key];
  const heading = fill(s.heading, vars);
  const body = fill(s.body, vars);
  const subject = fill(s.subject, vars)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  const cacheKey = `${key}|${heading}|${body}|${vars.url ?? ''}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const cta =
    s.cta && vars.url
      ? `<mj-button background-color="#0B2545" color="#ffffff" href="${esc(vars.url)}" font-weight="600" border-radius="6px">${esc(s.cta)}</mj-button>`
      : '';
  const { html } = await mjml2html(
    `<mjml><mj-head><mj-attributes><mj-all font-family="IBM Plex Sans, Segoe UI, Arial, sans-serif" /><mj-text font-size="15px" line-height="1.55" color="#1f2937" /></mj-attributes><mj-title>${esc(subject)}</mj-title></mj-head>
    <mj-body background-color="#f3f5f8">
      <mj-section background-color="#0B2545" padding="18px 24px"><mj-column><mj-text color="#ffffff" font-size="18px" font-weight="700">WatchDog Support</mj-text></mj-column></mj-section>
      <mj-section background-color="#ffffff" padding="24px"><mj-column>
        <mj-text font-size="20px" font-weight="700" color="#0B2545">${heading}</mj-text>
        <mj-text>${body}</mj-text>
        ${cta}
      </mj-column></mj-section>
      <mj-section padding="12px 24px"><mj-column><mj-text font-size="12px" color="#6b7280">You are receiving this because you have an account with WatchDog Support. Manage notifications in your profile. WatchDog is a brand of Apollo Infoways Pvt. Ltd.</mj-text></mj-column></mj-section>
    </mj-body></mjml>`,
    { validationLevel: 'strict' },
  );
  const text = `${stripTags(heading)}\n\n${stripTags(body.replace(/<br\s*\/?>/g, '\n'))}${vars.url ? `\n\n${s.cta ?? 'Open'}: ${vars.url}` : ''}\n\n— WatchDog Support`;
  const out = { subject, html, text };
  if (cache.size > 500) cache.clear();
  cache.set(cacheKey, out);
  return out;
}

const stripTags = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
