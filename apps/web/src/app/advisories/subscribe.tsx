'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ADVISORY_SEVERITY_LABELS, type AdvisorySeverity } from '@wd/contracts';
import { Button, Notice } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

interface Sub {
  subscribed: boolean;
  familyKeys: string[];
  minSeverity: AdvisorySeverity;
}

/** Email alerts for new and updated advisories, filtered by family and minimum severity. */
export function Subscribe({
  signedIn,
  families,
}: {
  signedIn: boolean;
  families: { key: string; name: string }[];
}) {
  const [sub, setSub] = useState<Sub | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [min, setMin] = useState<AdvisorySeverity>('medium');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    apiFetch<Sub>('/v1/me/advisory-subscription')
      .then((s) => {
        setSub(s);
        setKeys(s.familyKeys);
        setMin(s.minSeverity);
      })
      .catch(() => undefined);
  }, [signedIn]);

  if (!signedIn)
    return (
      <section aria-labelledby="sub-h">
        <h2 id="sub-h" className="font-semibold">
          Email alerts
        </h2>
        <p className="mt-1 text-muted">
          <Link
            href="/auth/login?returnTo=/advisories"
            className="font-medium text-teal-ink underline underline-offset-2"
          >
            Sign in
          </Link>{' '}
          to get an email when an advisory affects the products you choose. Administrators of
          organisations with affected devices are always told.
        </p>
      </section>
    );

  const save = async (remove = false) => {
    setBusy(true);
    setMsg(null);
    try {
      if (remove) {
        await apiFetch('/v1/me/advisory-subscription', { method: 'DELETE' });
        setSub({ subscribed: false, familyKeys: [], minSeverity: 'medium' });
        setMsg({ tone: 'success', text: 'Email alerts turned off.' });
      } else {
        setSub(
          await apiFetch<Sub>('/v1/me/advisory-subscription', {
            method: 'PUT',
            body: { familyKeys: keys, minSeverity: min },
          }),
        );
        setMsg({ tone: 'success', text: 'Email alerts saved.' });
      }
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ClientApiError ? e.title : 'Could not save' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="sub-h">
      <h2 id="sub-h" className="font-semibold">
        Email alerts
      </h2>
      <p className="mt-1 text-muted">
        {sub?.subscribed
          ? 'You get alerts for:'
          : 'Get an email when an advisory is published for:'}
      </p>
      <fieldset className="mt-2 space-y-1.5">
        <legend className="sr-only">Product families (none ticked means all)</legend>
        {families.map((f) => (
          <label key={f.key} className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4"
              checked={keys.includes(f.key)}
              onChange={(e) =>
                setKeys(e.target.checked ? [...keys, f.key] : keys.filter((k) => k !== f.key))
              }
            />
            {f.name}
          </label>
        ))}
        <p className="text-xs text-muted">None ticked means every family.</p>
      </fieldset>
      <label className="mt-3 flex flex-col gap-1.5 font-medium">
        Minimum severity
        <select
          value={min}
          onChange={(e) => setMin(e.target.value as AdvisorySeverity)}
          className="h-10 rounded-s border border-line bg-surface px-3 font-normal"
        >
          {Object.entries(ADVISORY_SEVERITY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v} and above
            </option>
          ))}
        </select>
      </label>
      {msg && (
        <div className="mt-3">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" busy={busy} onClick={() => save()}>
          {sub?.subscribed ? 'Save alerts' : 'Turn on alerts'}
        </Button>
        {sub?.subscribed && (
          <Button size="sm" variant="ghost" onClick={() => save(true)}>
            Turn off
          </Button>
        )}
      </div>
    </section>
  );
}
