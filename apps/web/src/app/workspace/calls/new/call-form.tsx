'use client';
import { useEffect, useState } from 'react';
import {
  SEVERITY_LABELS,
  type CallerOrg,
  type CallerOrgDetail,
  type CaseCategory,
  type Severity,
} from '@wd/contracts';
import { Button, Field, Input, Notice, Select, Textarea } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const CATEGORY_LABEL: Record<CaseCategory, string> = {
  hardware: 'Hardware',
  software: 'Software / firmware',
  config: 'Configuration',
  performance: 'Performance',
  security: 'Security',
  licensing: 'Licensing',
  documentation: 'Documentation',
};

/** Current India time as a value for <input type="datetime-local">. */
const istNow = () => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

export function CallForm() {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<CallerOrg[]>([]);
  const [org, setOrg] = useState<CallerOrgDetail | null>(null);
  const [f, setF] = useState({
    requesterId: '',
    serialNumber: '',
    callAt: istNow(),
    severity: 'P2' as Severity,
    category: 'software' as CaseCategory,
    subject: '',
    description: '',
    stepsTried: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (org || q.trim().length < 2) {
      setFound([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch<{ items: CallerOrg[] }>(
          `/v1/workspace/callers?q=${encodeURIComponent(q.trim())}`,
        );
        setFound(r.items);
      } catch {
        setFound([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, org]);

  async function pick(o: CallerOrg) {
    const d = await apiFetch<CallerOrgDetail>(`/v1/workspace/callers/${o.id}`);
    setOrg(d);
    setF((x) => ({
      ...x,
      requesterId: d.contacts.length === 1 ? d.contacts[0]!.id : '',
      serialNumber: d.devices.length === 1 ? d.devices[0]!.serialNumber : '',
    }));
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    const er: Record<string, string> = {};
    if (!f.requesterId) er.requesterId = 'Choose who called.';
    if (!f.serialNumber.trim()) er.serialNumber = 'Choose the device, or type its serial number.';
    if (f.subject.trim().length < 8) er.subject = 'Write a short summary of at least 8 characters.';
    if (!f.description.trim()) er.description = 'Write down what the caller told you.';
    if (!f.callAt) er.callAt = 'Enter when the call came in.';
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ number: string }>('/v1/cases', {
        method: 'POST',
        body: {
          orgId: org.id,
          requesterId: f.requesterId,
          serialNumber: f.serialNumber.trim(),
          severity: f.severity,
          category: f.category,
          subject: f.subject.trim(),
          description: f.description.trim(),
          ...(f.stepsTried.trim() ? { stepsTried: f.stepsTried.trim() } : {}),
          channel: 'phone',
          callStartedAt: new Date(`${f.callAt}:00+05:30`).toISOString(),
        },
      });
      window.location.href = `/workspace/cases/${r.number}`;
    } catch (x) {
      setMsg(x instanceof ClientApiError ? (x.detail ?? x.title) : 'Could not open the case.');
      setBusy(false);
    }
  }

  if (!org)
    return (
      <div className="space-y-3">
        <Field
          label="Customer"
          hint="Search by organisation, caller name, phone number, email or a device serial number."
        >
          {(a) => (
            <Input
              {...a}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
              autoComplete="off"
            />
          )}
        </Field>
        {found.length > 0 && (
          <ul
            className="divide-y divide-line rounded-s border border-line"
            aria-label="Matching customers"
          >
            {found.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-ink/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                  onClick={() => pick(o)}
                >
                  {o.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && found.length === 0 && (
          <p className="text-sm text-muted">
            No customer matches yet. Keep typing, or try a serial number.
          </p>
        )}
      </div>
    );

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3">
        <p className="text-lg font-semibold">{org.name}</p>
        <button
          type="button"
          className="text-sm text-teal-ink underline underline-offset-2"
          onClick={() => {
            setOrg(null);
            setQ('');
          }}
        >
          Choose another customer
        </button>
      </div>
      <Field label="Who called" required error={errors.requesterId}>
        {(a) => (
          <Select {...a} value={f.requesterId} onChange={set('requesterId')}>
            <option value="">Choose a person</option>
            {org.contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.phone ? `, ${c.phone}` : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {org.contacts.length === 0 && (
        <Notice tone="warning">
          This organisation has no active portal users yet. Ask their administrator to add the
          caller, then log the call.
        </Notice>
      )}
      <Field
        label="Device"
        required
        error={errors.serialNumber}
        hint="The serial number on the device label."
      >
        {(a) =>
          org.devices.length ? (
            <Select {...a} value={f.serialNumber} onChange={set('serialNumber')}>
              <option value="">Choose a device</option>
              {org.devices.map((d) => (
                <option key={d.serialNumber} value={d.serialNumber}>
                  {d.modelName}, {d.serialNumber}
                  {d.siteName ? `, ${d.siteName}` : ''}
                  {d.coveredUntil ? `, covered to ${d.coveredUntil}` : ', not covered'}
                </option>
              ))}
            </Select>
          ) : (
            <Input {...a} value={f.serialNumber} onChange={set('serialNumber')} />
          )
        }
      </Field>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Call came in at (IST)" required error={errors.callAt}>
          {(a) => <Input {...a} type="datetime-local" value={f.callAt} onChange={set('callAt')} />}
        </Field>
        <Field label="Severity" required>
          {(a) => (
            <Select {...a} value={f.severity} onChange={set('severity')}>
              {(['P1', 'P2', 'P3', 'P4'] as Severity[]).map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Category" required>
          {(a) => (
            <Select {...a} value={f.category} onChange={set('category')}>
              {(Object.keys(CATEGORY_LABEL) as CaseCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Summary" required error={errors.subject}>
        {(a) => <Input {...a} value={f.subject} onChange={set('subject')} maxLength={200} />}
      </Field>
      <Field label="What the caller told you" required error={errors.description}>
        {(a) => <Textarea {...a} rows={6} value={f.description} onChange={set('description')} />}
      </Field>
      <Field label="What they have already tried">
        {(a) => <Textarea {...a} rows={3} value={f.stepsTried} onChange={set('stepsTried')} />}
      </Field>
      {msg && <Notice tone="error">{msg}</Notice>}
      <Button type="submit" busy={busy}>
        Open the case
      </Button>
    </form>
  );
}
