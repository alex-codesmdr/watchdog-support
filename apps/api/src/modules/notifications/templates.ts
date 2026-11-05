import mjml2html from 'mjml';

/**
 * Transactional email templates (MJML → responsive HTML + plain-text part).
 * Strings are per-locale (English and Hindi), chosen by the recipient's email language.
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
  | 'case_customer_escalated'
  | 'sla_warning'
  | 'sla_breached'
  | 'renewal_requested'
  | 'coverage_expiring'
  | 'rma_update'
  | 'rma_requested'
  | 'advisory_published'
  | 'user_invited';

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
  sla_warning: {
    subject: '[SLA {{threshold}}%] {{number}} {{metricLabel}} due {{due}}',
    heading: '{{metricLabel}} is {{threshold}}% through its SLA',
    body: 'Case {{number}} ({{severity}}, {{tier}}): "{{subject}}". Due by <b>{{due}} IST</b>. Assigned to {{assignee}}.',
    cta: 'Open case',
  },
  sla_breached: {
    subject: '[SLA BREACH] {{number}} {{metricLabel}} missed',
    heading: '{{metricLabel}} SLA breached on {{number}}',
    body: 'Case {{number}} ({{severity}}, {{tier}}, {{org}}): "{{subject}}" missed its {{metricLabel}} target due {{due}} IST. {{escalation}}',
    cta: 'Open case',
  },
  case_customer_escalated: {
    subject: '[ESCALATION] {{number}} – {{org}}',
    heading: 'Customer escalation on {{number}}',
    body: '{{org}} escalated case "{{subject}}" ({{severity}}). Review the justification on the case and respond per the escalation matrix.',
    cta: 'Open case',
  },
  renewal_requested: {
    subject: '[Renewal] {{org}} – {{serial}} ({{model}})',
    heading: 'Renewal quote requested',
    body: '{{requester}} at <b>{{org}}</b> asked for a renewal quote for {{model}}, serial {{serial}}. Current coverage: {{coverage}}. Requested tier: {{tier}}.<br>Note: {{note}}',
  },
  coverage_expiring: {
    subject: 'WatchDog coverage ends in {{days}} days for {{count}} device(s)',
    heading: 'Coverage is ending soon',
    body: 'Support coverage for {{count}} device(s) at <b>{{org}}</b> ends within {{days}} days, the earliest on {{earliest}}:<br>{{listHtml}}<br>Request a renewal quote from the Devices page to keep 24×7 support and software updates.',
    cta: 'Review devices',
  },
  rma_update: {
    subject: '[{{rma}}] {{statusLabel}}',
    heading: '{{rma}}: {{statusLabel}}',
    body: '{{model}}, serial {{serial}} (case {{caseNumber}}).<br>{{detailHtml}}',
    cta: 'View RMA',
  },
  rma_requested: {
    subject: '[Action] {{rma}} requested by {{org}}',
    heading: 'New RMA request',
    body: '{{org}} asked for a {{typeLabel}} of {{model}}, serial {{serial}} (case {{caseNumber}}). Fault: "{{fault}}"',
    cta: 'Review RMA',
  },
  advisory_published: {
    subject: '[{{wdId}}] {{prefix}}{{severityLabel}}: {{title}}',
    heading: '{{prefix}}{{wdId}}: {{title}}',
    body: 'Severity <b>{{severityLabel}}</b>{{cvss}}. {{summary}}<br>Affected: {{products}}.{{yourDevices}}{{revision}}',
    cta: 'Read the advisory',
  },
  user_invited: {
    subject: '{{inviter}} added you to WatchDog Support',
    heading: 'Welcome, {{name}}',
    body: '{{inviter}} added you to <b>{{org}}</b> on WatchDog Support. A separate email will ask you to verify your address, set a password and enrol an authenticator app. After that you can open and follow support cases for your organisation.',
    cta: 'Go to WatchDog Support',
  },
};

/** Hindi (हिन्दी). Technical terms customers use day to day (case, SLA, RMA, serial) stay in English. */
const HI: Strings = {
  registration_received: {
    subject: 'आपका WatchDog Support पंजीकरण हमें मिल गया है',
    heading: 'पंजीकरण के लिए धन्यवाद, {{name}}',
    body: 'हमें <b>{{org}}</b> का पंजीकरण मिल गया है। हमारी टीम हर नए संगठन की जाँच करती है, आमतौर पर एक कार्यदिवस में। स्वीकृति मिलते ही आपको पासवर्ड और मल्टी-फ़ैक्टर प्रमाणीकरण सेट करने के लिए एक ईमेल मिलेगा।',
  },
  registration_approved: {
    subject: 'आपका WatchDog Support खाता स्वीकृत हो गया है',
    heading: 'WatchDog Support में आपका स्वागत है',
    body: '<b>{{org}}</b> अब सक्रिय है। एक अलग ईमेल में आपसे अपना ईमेल पता सत्यापित करने, पासवर्ड बनाने और ऑथेंटिकेटर ऐप जोड़ने के लिए कहा जाएगा। इसके बाद आप case खोल सकते हैं, SLA देख सकते हैं और अपनी टीम को जोड़ सकते हैं।',
    cta: 'WatchDog Support खोलें',
  },
  registration_rejected: {
    subject: 'आपका WatchDog Support पंजीकरण',
    heading: 'हम यह पंजीकरण स्वीकार नहीं कर सके',
    body: 'हम <b>{{org}}</b> के पंजीकरण की पुष्टि नहीं कर पाए। अगर आपको लगता है कि यह गलती है, तो इस ईमेल का उत्तर दें या अपने WatchDog अकाउंट मैनेजर से संपर्क करें।',
  },
  staff_registration_pending: {
    subject: '[कार्रवाई] नया संगठन स्वीकृति की प्रतीक्षा में: {{org}}',
    heading: 'नया पंजीकरण',
    body: '<b>{{org}}</b> ने एडमिन {{name}} ({{email}}) के साथ पंजीकरण किया है। एडमिन कंसोल में इसकी समीक्षा करें।',
    cta: 'पंजीकरण देखें',
  },
  case_created: {
    subject: '[{{number}}] case खोला गया: {{subject}}',
    heading: 'case {{number}} खुल गया है',
    body: 'हमने आपका <b>{{severity}}</b> case "{{subject}}" दर्ज कर लिया है।<br>पहला उत्तर <b>{{firstResponseDue}}</b> (IST) तक मिलेगा। और जानकारी जोड़ने के लिए आप इस ईमेल का उत्तर दे सकते हैं।',
    cta: 'case देखें',
  },
  case_reply: {
    subject: '[{{number}}] WatchDog Support की ओर से नया अपडेट',
    heading: 'case {{number}} पर अपडेट',
    body: '{{author}} ने लिखा:<br><br>{{excerpt}}',
    cta: 'देखें और उत्तर दें',
  },
  case_customer_reply: {
    subject: '[{{number}}] ग्राहक का उत्तर: {{subject}}',
    heading: '{{number}} पर ग्राहक का अपडेट',
    body: '{{author}} ({{org}}) ने लिखा:<br><br>{{excerpt}}',
    cta: 'वर्कस्पेस में खोलें',
  },
  case_status: {
    subject: '[{{number}}] स्थिति: {{status}}',
    heading: 'case {{number}} की स्थिति अब {{status}} है',
    body: '"{{subject}}" की स्थिति {{from}} से बदलकर <b>{{status}}</b> हो गई है।',
    cta: 'case देखें',
  },
  case_resolved: {
    subject: '[{{number}}] हल हो गया – हमारी सेवा कैसी रही?',
    heading: 'case {{number}} हल हो गया है',
    body: 'हमने "{{subject}}" को हल के रूप में चिह्नित किया है। अगर समस्या बनी रहती है, तो बस उत्तर दें और case फिर से खुल जाएगा।<br><br>कृपया 10 सेकंड निकालकर हमारी सहायता को रेटिंग दें।',
    cta: 'इस case को रेटिंग दें',
  },
  sla_warning: {
    subject: '[SLA {{threshold}}%] {{number}} {{metricLabel}} की समय-सीमा {{due}}',
    heading: '{{metricLabel}} का {{threshold}}% SLA समय बीत चुका है',
    body: 'case {{number}} ({{severity}}, {{tier}}): "{{subject}}"। समय-सीमा <b>{{due}} IST</b>। ज़िम्मेदार: {{assignee}}।',
    cta: 'case खोलें',
  },
  sla_breached: {
    subject: '[SLA उल्लंघन] {{number}} {{metricLabel}} चूक गया',
    heading: '{{number}} पर {{metricLabel}} SLA का उल्लंघन',
    body: 'case {{number}} ({{severity}}, {{tier}}, {{org}}): "{{subject}}" अपना {{metricLabel}} लक्ष्य ({{due}} IST) चूक गया। {{escalation}}',
    cta: 'case खोलें',
  },
  case_customer_escalated: {
    subject: '[एस्केलेशन] {{number}} – {{org}}',
    heading: '{{number}} पर ग्राहक ने एस्केलेट किया',
    body: '{{org}} ने case "{{subject}}" ({{severity}}) एस्केलेट किया है। case पर दिया गया कारण देखें और एस्केलेशन मैट्रिक्स के अनुसार कार्रवाई करें।',
    cta: 'case खोलें',
  },
  renewal_requested: {
    subject: '[नवीनीकरण] {{org}} – {{serial}} ({{model}})',
    heading: 'नवीनीकरण कोटेशन का अनुरोध',
    body: '<b>{{org}}</b> के {{requester}} ने {{model}}, serial {{serial}} के नवीनीकरण का कोटेशन माँगा है। वर्तमान कवरेज: {{coverage}}। अनुरोधित स्तर: {{tier}}।<br>टिप्पणी: {{note}}',
  },
  coverage_expiring: {
    subject: '{{count}} डिवाइस का WatchDog कवरेज {{days}} दिनों में समाप्त हो रहा है',
    heading: 'कवरेज जल्द समाप्त हो रहा है',
    body: '<b>{{org}}</b> के {{count}} डिवाइस का सपोर्ट कवरेज {{days}} दिनों में समाप्त हो रहा है, सबसे पहले {{earliest}} को:<br>{{listHtml}}<br>24×7 सपोर्ट और सॉफ़्टवेयर अपडेट जारी रखने के लिए Devices पेज से नवीनीकरण कोटेशन माँगें।',
    cta: 'डिवाइस देखें',
  },
  rma_update: {
    subject: '[{{rma}}] {{statusLabel}}',
    heading: '{{rma}}: {{statusLabel}}',
    body: '{{model}}, serial {{serial}} (case {{caseNumber}})।<br>{{detailHtml}}',
    cta: 'RMA देखें',
  },
  rma_requested: {
    subject: '[कार्रवाई] {{org}} ने {{rma}} का अनुरोध किया',
    heading: 'नया RMA अनुरोध',
    body: '{{org}} ने {{model}}, serial {{serial}} (case {{caseNumber}}) के लिए {{typeLabel}} माँगा है। खराबी: "{{fault}}"',
    cta: 'RMA देखें',
  },
  advisory_published: {
    subject: '[{{wdId}}] {{prefix}}{{severityLabel}}: {{title}}',
    heading: '{{prefix}}{{wdId}}: {{title}}',
    body: 'गंभीरता <b>{{severityLabel}}</b>{{cvss}}। {{summary}}<br>प्रभावित: {{products}}।{{yourDevices}}{{revision}}',
    cta: 'एडवाइज़री पढ़ें',
  },
  user_invited: {
    subject: '{{inviter}} ने आपको WatchDog Support में जोड़ा है',
    heading: 'स्वागत है, {{name}}',
    body: '{{inviter}} ने आपको WatchDog Support पर <b>{{org}}</b> में जोड़ा है। एक अलग ईमेल में आपसे अपना ईमेल पता सत्यापित करने, पासवर्ड बनाने और ऑथेंटिकेटर ऐप जोड़ने के लिए कहा जाएगा। इसके बाद आप अपने संगठन के सपोर्ट case खोल और देख सकेंगे।',
    cta: 'WatchDog Support खोलें',
  },
};

/** Words around the message: footer, sign-off, fallback link label. */
const CHROME: Record<string, { footer: string; signoff: string; open: string; lang: string }> = {
  en: {
    footer:
      'You are receiving this because you have an account with WatchDog Support. Change your email language in My account. WatchDog is a brand of Apollo Infoways Pvt. Ltd.',
    signoff: 'WatchDog Support',
    open: 'Open',
    lang: 'en',
  },
  hi: {
    footer:
      'आपको यह ईमेल इसलिए मिला है क्योंकि WatchDog Support पर आपका खाता है। ईमेल की भाषा My account में बदली जा सकती है। WatchDog, Apollo Infoways Pvt. Ltd. का ब्रांड है।',
    signoff: 'WatchDog Support',
    open: 'खोलें',
    lang: 'hi',
  },
};

const LOCALES: Record<string, Strings> = { en: EN, hi: HI };

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
  const lc = LOCALES[locale.slice(0, 2)] ? locale.slice(0, 2) : 'en';
  const s = LOCALES[lc]![key];
  const ch = CHROME[lc]!;
  const heading = fill(s.heading, vars);
  const body = fill(s.body, vars);
  const subject = fill(s.subject, vars)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  const cacheKey = `${lc}|${key}|${heading}|${body}|${vars.url ?? ''}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const cta =
    s.cta && vars.url
      ? `<mj-button background-color="#0B2545" color="#ffffff" href="${esc(vars.url)}" font-weight="600" border-radius="6px">${esc(s.cta)}</mj-button>`
      : '';
  const { html } = await mjml2html(
    `<mjml lang="${ch.lang}"><mj-head><mj-attributes><mj-all font-family="IBM Plex Sans, Noto Sans Devanagari, Nirmala UI, Mangal, Segoe UI, Arial, sans-serif" /><mj-text font-size="15px" line-height="1.55" color="#1f2937" /></mj-attributes><mj-title>${esc(subject)}</mj-title></mj-head>
    <mj-body background-color="#f3f5f8">
      <mj-section background-color="#0B2545" padding="18px 24px"><mj-column><mj-text color="#ffffff" font-size="18px" font-weight="700">WatchDog Support</mj-text></mj-column></mj-section>
      <mj-section background-color="#ffffff" padding="24px"><mj-column>
        <mj-text font-size="20px" font-weight="700" color="#0B2545">${heading}</mj-text>
        <mj-text>${body}</mj-text>
        ${cta}
      </mj-column></mj-section>
      <mj-section padding="12px 24px"><mj-column><mj-text font-size="12px" color="#6b7280">${esc(ch.footer)}</mj-text></mj-column></mj-section>
    </mj-body></mjml>`,
    { validationLevel: 'strict' },
  );
  const text = `${stripTags(heading)}\n\n${stripTags(body.replace(/<br\s*\/?>/g, '\n'))}${vars.url ? `\n\n${s.cta ?? ch.open}: ${vars.url}` : ''}\n\n— ${ch.signoff}`;
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

/** Every template key, for checks that each language is complete. */
export const TEMPLATE_KEYS = Object.keys(EN) as TemplateKey[];
/** The placeholders a template uses, sorted (for completeness checks and the template editor). */
export function placeholders(key: TemplateKey, lang: 'en' | 'hi' = 'en'): string[] {
  const t = LOCALES[lang]![key];
  const all = [t.subject, t.heading, t.body, t.cta ?? ''].join(' ');
  return [...new Set([...all.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))].sort();
}
