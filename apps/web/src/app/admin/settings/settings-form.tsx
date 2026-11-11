'use client';
import { useState } from 'react';
import type { PortalSettings } from '@wd/contracts';
import { Button, Field, Input, Notice } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

export function SettingsForm({ initial }: { initial: PortalSettings }) {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const set = <K extends keyof PortalSettings>(k: K, v: PortalSettings[K]) =>
    setS((x) => ({ ...x, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      setS(await apiFetch<PortalSettings>('/v1/admin/settings', { method: 'PUT', body: s }));
      setMsg({ tone: 'success', text: 'Settings saved.' });
    } catch (err) {
      setMsg({
        tone: 'error',
        text: err instanceof ClientApiError ? (err.detail ?? err.title) : 'Could not save',
      });
    } finally {
      setBusy(false);
    }
  }

  const text = (
    k: 'p1Phone' | 'p2Phone' | 'businessHours' | 'supportEmail' | 'securityEmail',
    label: string,
    hint: string,
    type = 'text',
  ) => (
    <Field label={label} hint={hint} required>
      {(p) => <Input {...p} type={type} value={s[k]} onChange={(e) => set(k, e.target.value)} />}
    </Field>
  );
  const flag = (
    k: 'selfRegistration' | 'publicWarrantyCheck' | 'monthlyReviewEmail',
    label: string,
    hint: string,
  ) => (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1"
        checked={s[k]}
        onChange={(e) => set(k, e.target.checked)}
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-sm text-muted">{hint}</span>
      </span>
    </label>
  );

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 font-semibold">Contact details</legend>
        {text(
          'p1Phone',
          'P1 outage line',
          'Shown on the home page and when a customer opens a P1 case.',
          'tel',
        )}
        {text('p2Phone', 'P2 line', 'Shown on the home page.', 'tel')}
        {text(
          'businessHours',
          'Business hours for P3 and P4',
          'For example: Mon–Sat, 9:00 to 18:00 IST',
        )}
        {text('supportEmail', 'Support email', 'Shown when registrations are closed.', 'email')}
        {text(
          'securityEmail',
          'Security reports email',
          'Shown on the security advisories page.',
          'email',
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 font-semibold">Features</legend>
        {flag(
          'selfRegistration',
          'New organisations can register',
          'When off, the Register link disappears and the form is closed.',
        )}
        {flag(
          'publicWarrantyCheck',
          'Anyone can check a warranty',
          'When off, only signed-in customers see coverage, for their own devices.',
        )}
        {flag(
          'monthlyReviewEmail',
          'Monthly service review email',
          'On the first of each month, customer administrators get a summary of last month: cases, response times, targets met, satisfaction and coverage ending soon.',
        )}
      </fieldset>
      <div>
        <Button type="submit" busy={busy}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
