'use client';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  CaseCategory,
  SEVERITY_LABELS,
  type AssetSummary,
  type CaseDetail,
  type CaseSummary,
  type SerialValidation,
  type Severity,
} from '@wd/contracts';
import { Button, cn, Field, Input, Notice, Select, Textarea } from '@wd/ui';
import { Uploader, type UploadItem } from '@/components/case/uploader';
import { apiFetch, ClientApiError } from '@/lib/client';

const STEPS = ['Device', 'Problem', 'Files', 'Review'] as const;
const CATEGORY_LABEL: Record<CaseCategory, string> = {
  hardware: 'Hardware',
  software: 'Software / firmware',
  config: 'Configuration',
  performance: 'Performance',
  security: 'Security',
  licensing: 'Licensing',
  documentation: 'Documentation',
};
const SEV_HELP: Record<Severity, string> = {
  P1: 'Network or service is down, or a security incident is in progress.',
  P2: 'Severely degraded; a major function is unusable.',
  P3: 'Impaired, but a workaround keeps you running.',
  P4: 'Question, documentation or feature request.',
};
const TIER: Record<string, string> = {
  standard: 'Standard',
  premium: 'Premium',
  mission_critical: 'Mission-Critical 24×7',
};

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

export function NewCaseWizard({
  initialSubject,
  initialSerial,
}: {
  initialSubject: string;
  initialSerial: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  // One key per form: a retry after a network error never opens a duplicate case.
  const [idemKey] = useState(() => crypto.randomUUID());
  const [serial, setSerial] = useState(initialSerial);
  const [form, setForm] = useState({
    severity: '' as Severity | '',
    category: '' as CaseCategory | '',
    subject: initialSubject,
    description: '',
    stepsTried: '',
    businessImpact: '',
    softwareVersion: '',
  });
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Partners open cases for the customers that delegated access to them.
  const orgs = useQuery({
    queryKey: ['my-orgs'],
    queryFn: () =>
      apiFetch<{ items: Array<{ id: string; name: string; own: boolean }> }>(
        '/v1/me/organizations',
      ),
  });
  const customers = (orgs.data?.items ?? []).filter((o) => !o.own);
  const isPartner = customers.length > 0;
  const [orgId, setOrgId] = useState('');
  const orgQs = isPartner && orgId ? `&orgId=${orgId}` : '';
  const assets = useQuery({
    queryKey: ['assets', orgId],
    queryFn: () =>
      apiFetch<{ items: AssetSummary[] }>(`/v1/assets${orgQs ? `?${orgQs.slice(1)}` : ''}`),
    enabled: !isPartner || !!orgId,
  });
  const dSerial = useDebounced(serial.trim().toUpperCase(), 350);
  const validation = useQuery({
    queryKey: ['serial', dSerial, orgId],
    queryFn: () =>
      apiFetch<SerialValidation>(
        `/v1/assets/validate?serial=${encodeURIComponent(dSerial)}${orgQs}`,
      ),
    enabled: dSerial.length >= 6 && (!isPartner || !!orgId),
  });
  const dSubject = useDebounced(form.subject.trim(), 500);
  const articles = useQuery({
    queryKey: ['kb-suggest', dSubject],
    queryFn: () =>
      apiFetch<{ items: Array<{ slug: string; title: string }> }>(
        `/v1/kb/suggest?q=${encodeURIComponent(dSubject)}`,
      ),
    enabled: dSubject.length >= 6,
  });
  const similar = useQuery({
    queryKey: ['similar', dSubject],
    queryFn: () =>
      apiFetch<{ items: CaseSummary[] }>(
        `/v1/cases?status=closed&limit=3&q=${encodeURIComponent(dSubject)}`,
      ),
    enabled: dSubject.length >= 8,
  });

  const asset = validation.data?.asset ?? null;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const uploading = files.some((f) => !f.id && !f.error);
  const uploadIds = useMemo(() => files.filter((f) => f.id).map((f) => f.id!), [files]);

  function validate(s: number): boolean {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (isPartner && !orgId) e.org = 'Choose the customer this case is for.';
      else if (!validation.data?.valid)
        e.serial =
          validation.data?.reason === 'not_entitled'
            ? 'This device has no active support contract.'
            : 'Enter the serial number of a registered device.';
    }
    if (s === 1) {
      if (!form.severity) e.severity = 'Choose how severe this is.';
      if (!form.category) e.category = 'Choose a category.';
      if (form.subject.trim().length < 8)
        e.subject = 'Describe the problem in at least 8 characters.';
      if (!form.description.trim()) e.description = 'Tell us what is happening.';
    }
    if (s === 2 && uploading) e.files = 'Wait for uploads to finish, or remove them.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }
  const next = () => validate(step) && setStep((s) => Math.min(s + 1, STEPS.length - 1));

  async function submit() {
    setBusy(true);
    setSubmitError(null);
    try {
      const c = await apiFetch<CaseDetail>('/v1/cases', {
        method: 'POST',
        headers: { 'idempotency-key': idemKey },
        body: {
          serialNumber: serial.trim(),
          ...(isPartner && orgId ? { orgId } : {}),
          ...form,
          softwareVersion: form.softwareVersion || undefined,
          stepsTried: form.stepsTried || undefined,
          businessImpact: form.businessImpact || undefined,
          uploadIds,
        },
      });
      router.push(`/portal/cases/${c.number}?created=1`);
    } catch (e) {
      setBusy(false);
      setSubmitError(
        e instanceof ClientApiError
          ? [e.title, e.detail].filter(Boolean).join('. ')
          : 'The case was not created. Try again.',
      );
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_18rem]">
      <div>
        <h1 className="text-2xl font-semibold">Open a case</h1>
        <ol className="mt-6 flex flex-wrap gap-2" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === step ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-s px-3 py-1.5 text-sm',
                i === step ? 'bg-navy text-white' : i < step ? 'text-ink' : 'text-muted',
              )}
            >
              <span className="tabular-nums">{i + 1}</span> {s}
            </li>
          ))}
        </ol>

        <div className="mt-6 flex flex-col gap-5 rounded-m border border-line bg-surface p-6">
          {step === 0 && (
            <>
              {isPartner && (
                <Field
                  label="Customer"
                  required
                  hint="The organisation that owns the device."
                  error={errors.org}
                >
                  {(p) => (
                    <Select {...p} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                      <option value="">Choose a customer</option>
                      {customers.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              <Field
                label="Serial number"
                required
                hint="Printed on the device label, or run “display device manuinfo”."
                error={errors.serial}
              >
                {(p) => (
                  <Input
                    {...p}
                    value={serial}
                    onChange={(e) => setSerial(e.target.value)}
                    className="font-mono uppercase"
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </Field>
              {validation.isFetching && <p className="text-sm text-muted">Checking…</p>}
              {asset && (
                <Notice
                  tone={validation.data?.valid ? 'success' : 'warning'}
                  title={asset.modelName}
                >
                  {asset.siteName && <>{asset.siteName}. </>}
                  {asset.entitlement ? (
                    <>
                      Covered by {TIER[asset.entitlement.tier]} until {asset.entitlement.endsOn}.
                    </>
                  ) : (
                    <>No active support contract. Ask your account manager for a renewal quote.</>
                  )}
                </Notice>
              )}
              {validation.data && !asset && dSerial.length >= 6 && (
                <Notice tone="warning">
                  We could not find {dSerial} in your organisation’s registered devices.
                </Notice>
              )}
              {!!assets.data?.items.length && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-teal-ink">
                    Choose from your {assets.data.items.length} registered devices
                  </summary>
                  <ul className="mt-2 max-h-64 divide-y divide-line overflow-auto rounded-s border border-line">
                    {assets.data.items.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSerial(a.serialNumber);
                            setForm((f) => ({ ...f, softwareVersion: a.currentVersion ?? '' }));
                          }}
                          className="flex w-full justify-between gap-3 px-3 py-2 text-left hover:bg-paper"
                        >
                          <span>
                            <span className="font-mono">{a.serialNumber}</span>{' '}
                            <span className="text-muted">{a.modelName}</span>
                          </span>
                          <span className={a.entitlement ? 'text-muted' : 'text-amber-ink'}>
                            {a.entitlement ? TIER[a.entitlement.tier] : 'Not covered'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <fieldset>
                <legend className="text-sm font-medium">
                  Severity <span className="text-muted">(required)</span>
                </legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(['P1', 'P2', 'P3', 'P4'] as Severity[]).map((s) => (
                    <label
                      key={s}
                      className={cn(
                        'flex cursor-pointer flex-col gap-1 rounded-s border p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
                        form.severity === s ? 'border-navy bg-navy/5' : 'border-line',
                      )}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <input
                          type="radio"
                          name="severity"
                          value={s}
                          checked={form.severity === s}
                          onChange={set('severity')}
                          className="accent-[rgb(var(--wd-navy))]"
                        />
                        {SEVERITY_LABELS[s]}
                      </span>
                      <span className="pl-6 text-sm text-muted">{SEV_HELP[s]}</span>
                    </label>
                  ))}
                </div>
                {errors.severity && (
                  <p className="mt-1 text-xs font-medium text-danger">{errors.severity}</p>
                )}
                {form.severity === 'P1' && (
                  <Notice tone="warning" className="mt-3">
                    After submitting, also call 1800-000-0000 so an engineer engages immediately.
                  </Notice>
                )}
              </fieldset>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Category" required error={errors.category}>
                  {(p) => (
                    <Select {...p} value={form.category} onChange={set('category')}>
                      <option value="">Choose…</option>
                      {CaseCategory.options.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Software version" hint="Pre-filled from the device record.">
                  {(p) => (
                    <Input
                      {...p}
                      value={form.softwareVersion}
                      onChange={set('softwareVersion')}
                      className="font-mono"
                    />
                  )}
                </Field>
              </div>
              <Field label="Subject" required error={errors.subject}>
                {(p) => (
                  <Input {...p} value={form.subject} onChange={set('subject')} maxLength={200} />
                )}
              </Field>
              {!!articles.data?.items.length && (
                <div
                  className="rounded-s border border-teal/40 bg-teal/5 p-3 text-sm"
                  aria-live="polite"
                >
                  <p className="font-medium">These articles may solve it right away</p>
                  <ul className="mt-1 list-disc pl-5">
                    {articles.data.items.map((a) => (
                      <li key={a.slug}>
                        <a
                          className="text-teal-ink underline underline-offset-2"
                          href={`/kb/${a.slug}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {a.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!!similar.data?.items.length && (
                <div
                  className="rounded-s border border-line bg-paper p-3 text-sm"
                  aria-live="polite"
                >
                  <p className="font-medium">Similar resolved cases in your organisation</p>
                  <ul className="mt-1 list-disc pl-5">
                    {similar.data.items.map((c) => (
                      <li key={c.id}>
                        <a
                          className="text-teal-ink underline underline-offset-2"
                          href={`/portal/cases/${c.number}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {c.number}: {c.subject}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Field
                label="What is happening?"
                required
                hint="Include error messages and when it started. Wrap CLI output in ``` lines to keep formatting."
                error={errors.description}
              >
                {(p) => (
                  <Textarea
                    {...p}
                    value={form.description}
                    onChange={set('description')}
                    rows={7}
                  />
                )}
              </Field>
              <Field label="What have you tried?">
                {(p) => (
                  <Textarea {...p} value={form.stepsTried} onChange={set('stepsTried')} rows={3} />
                )}
              </Field>
              <Field label="Business impact" hint="Users, sites or services affected.">
                {(p) => (
                  <Textarea
                    {...p}
                    value={form.businessImpact}
                    onChange={set('businessImpact')}
                    rows={2}
                  />
                )}
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              <Uploader items={files} onChange={setFiles} />
              {errors.files && <Notice tone="warning">{errors.files}</Notice>}
            </>
          )}

          {step === 3 && (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted">Device</dt>
              <dd>
                <span className="font-mono">{serial.toUpperCase()}</span> {asset?.modelName}
              </dd>
              <dt className="text-muted">Severity</dt>
              <dd>{form.severity && SEVERITY_LABELS[form.severity]}</dd>
              <dt className="text-muted">Category</dt>
              <dd>{form.category && CATEGORY_LABEL[form.category]}</dd>
              <dt className="text-muted">Subject</dt>
              <dd>{form.subject}</dd>
              <dt className="text-muted">Description</dt>
              <dd className="whitespace-pre-wrap">{form.description}</dd>
              <dt className="text-muted">Files</dt>
              <dd>{uploadIds.length ? `${uploadIds.length} attached` : 'None'}</dd>
            </dl>
          )}

          {submitError && <Notice tone="error">{submitError}</Notice>}
          <div className="flex gap-3 pt-2">
            {step > 0 && (
              <Button variant="secondary" type="button" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
            {step < 3 ? (
              <Button type="button" onClick={next}>
                Continue
              </Button>
            ) : (
              <Button type="button" busy={busy} onClick={submit}>
                Open case
              </Button>
            )}
          </div>
        </div>
      </div>
      <aside className="text-sm text-muted">
        <h2 className="text-base font-semibold text-ink">What happens next</h2>
        <p className="mt-2">
          Your SLA clock starts when you open the case. You get a confirmation email with the case
          number, and you can reply to any of our emails to add information.
        </p>
      </aside>
    </div>
  );
}
