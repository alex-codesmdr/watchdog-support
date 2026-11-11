'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { AssetSummary, SiteView } from '@wd/contracts';
import { Button, Dialog, EmptyState, Field, Input, Notice, Select, Textarea, cn } from '@wd/ui';
import { useT } from '@/components/locale';
import { apiFetch, ClientApiError } from '@/lib/client';

const TIER: Record<string, string> = {
  standard: 'Standard',
  premium: 'Premium',
  mission_critical: 'Mission-Critical',
};
const KIND: Record<string, string> = {
  warranty: 'Warranty',
  amc: 'AMC',
  subscription: 'Subscription',
};
const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${d.slice(0, 10)}T00:00:00`),
  );

const LIFECYCLE = {
  eos_announced: 'End of sale announced',
  eos: 'No longer sold',
  eol: 'Support has ended',
} as const;
type Coverage = {
  label: string;
  vars?: Record<string, string | number>;
  tone: 'ok' | 'soon' | 'urgent' | 'none';
  days: number | null;
};
function coverage(a: AssetSummary, today: string): Coverage {
  if (!a.entitlement) return { label: 'No active coverage', tone: 'none', days: null };
  const days = Math.round(
    (Date.parse(`${a.entitlement.endsOn.slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
  if (days < 0)
    return {
      label: 'Ended {date}',
      vars: { date: fmtDate(a.entitlement.endsOn) },
      tone: 'none',
      days,
    };
  if (days <= 30) return { label: '{n} days left', vars: { n: days }, tone: 'urgent', days };
  if (days <= 90) return { label: '{n} days left', vars: { n: days }, tone: 'soon', days };
  return { label: 'Until {date}', vars: { date: fmtDate(a.entitlement.endsOn) }, tone: 'ok', days };
}
const toneCls: Record<Coverage['tone'], string> = {
  ok: 'text-ok',
  soon: 'text-amber-ink font-medium',
  urgent: 'text-danger font-semibold',
  none: 'text-muted',
};

export function Devices({
  assets,
  sites,
  openRenewals,
  canManage,
  canRenew,
  today,
}: {
  assets: AssetSummary[];
  sites: SiteView[];
  openRenewals: string[];
  canManage: boolean;
  canRenew: boolean;
  today: string;
}) {
  const router = useRouter();
  const [site, setSite] = useState('all');
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const tr = useT();
  const [q, setQ] = useState('');
  const [renewFor, setRenewFor] = useState<AssetSummary | null>(null);
  const [moveFor, setMoveFor] = useState<AssetSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = new Set(openRenewals);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return assets
      .map((a) => ({ a, c: coverage(a, today) }))
      .filter(({ a }) => site === 'all' || (site === 'none' ? !a.siteId : a.siteId === site))
      .filter(({ c }) => filter === 'all' || c.tone !== 'ok')
      .filter(
        ({ a }) =>
          !needle ||
          a.serialNumber.toLowerCase().includes(needle) ||
          a.modelName.toLowerCase().includes(needle),
      )
      .sort((x, y) => (x.c.days ?? -1e9) - (y.c.days ?? -1e9));
  }, [assets, site, filter, q, today]);
  const attention = assets.filter((a) => coverage(a, today).tone !== 'ok').length;

  const done = (msg: string) => {
    setNotice(msg);
    setRenewFor(null);
    setMoveFor(null);
    router.refresh();
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{tr('Devices')}</h1>
        <p className="mt-1 max-w-prose text-muted">
          {tr('{n} registered WatchDog devices.', { n: assets.length })}{' '}
          {attention > 0
            ? tr('{n} need attention: coverage ends within 90 days or has already ended.', {
                n: attention,
              })
            : tr('Every device is covered for at least the next 90 days.')}
        </p>
      </div>
      {notice && (
        <Notice tone="success" title={notice}>
          {tr('Our renewals team usually replies within one business day.')}
        </Notice>
      )}

      <div className="grid gap-10 lg:grid-cols-[1fr_18rem]">
        <section aria-labelledby="devices-h" className="min-w-0">
          <h2 id="devices-h" className="sr-only">
            {tr('Device list')}
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={tr('Find a device')} className="w-full sm:w-64">
              {(p) => (
                <Input
                  {...p}
                  type="search"
                  placeholder={tr('Serial or model')}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              )}
            </Field>
            <Field label="Site" className="w-full sm:w-52">
              {(p) => (
                <Select {...p} value={site} onChange={(e) => setSite(e.target.value)}>
                  <option value="all">All sites</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  <option value="none">No site set</option>
                </Select>
              )}
            </Field>
            <fieldset className="flex gap-1 rounded-s border border-line p-1 text-sm">
              <legend className="sr-only">Show</legend>
              {(['all', 'attention'] as const).map((f) => (
                <label
                  key={f}
                  className={cn(
                    'cursor-pointer rounded-s px-3 py-1.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
                    filter === f ? 'bg-navy text-white' : 'text-ink hover:bg-navy/5',
                  )}
                >
                  <input
                    type="radio"
                    name="show"
                    className="sr-only"
                    checked={filter === f}
                    onChange={() => setFilter(f)}
                  />
                  {f === 'all' ? 'All' : `Needs attention (${attention})`}
                </label>
              ))}
            </fieldset>
          </div>

          {rows.length === 0 ? (
            <div className="mt-6">
              <EmptyState title={assets.length ? 'No devices match' : 'No devices registered yet'}>
                {assets.length
                  ? 'Clear the search or choose another site.'
                  : 'Devices appear here once WatchDog registers them against your purchase order. Ask your account manager if something is missing.'}
              </EmptyState>
            </div>
          ) : (
            <ul className="mt-6 divide-y divide-line border-y border-line">
              {rows.map(({ a, c }) => (
                <li
                  key={a.id}
                  className="grid gap-x-6 gap-y-2 py-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_14.5rem] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold">{a.serialNumber}</p>
                    <p className="truncate text-sm text-muted">{a.modelName}</p>
                    {a.lifecycle && (
                      <details className="mt-1 text-sm">
                        <summary className="cursor-pointer text-amber-ink">
                          {tr(LIFECYCLE[a.lifecycle.stage])}
                          {a.lifecycle.endOfSupport
                            ? `: support ends ${fmtDate(a.lifecycle.endOfSupport)}`
                            : ''}
                        </summary>
                        <div className="mt-1 space-y-1 text-muted">
                          {a.lifecycle.endOfSale && (
                            <p>End of sale: {fmtDate(a.lifecycle.endOfSale)}</p>
                          )}
                          {a.lifecycle.endOfSupport && (
                            <p>End of support: {fmtDate(a.lifecycle.endOfSupport)}</p>
                          )}
                          {a.lifecycle.replacement && (
                            <p>Suggested replacement: {a.lifecycle.replacement}</p>
                          )}
                          {a.lifecycle.advice && <p>{a.lifecycle.advice}</p>}
                        </div>
                      </details>
                    )}
                  </div>
                  <p className="text-sm">
                    <span className="sr-only">Site: </span>
                    {a.siteName ?? <span className="text-muted">No site set</span>}
                  </p>
                  <p className="text-sm">
                    {a.entitlement && (
                      <span className="block text-muted">
                        {TIER[a.entitlement.tier]} {KIND[a.entitlement.kind] ?? a.entitlement.kind}
                      </span>
                    )}
                    <span className={toneCls[c.tone]}>{tr(c.label, c.vars)}</span>
                  </p>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    {canRenew &&
                      c.tone !== 'ok' &&
                      (pending.has(a.id) ? (
                        <span className="inline-flex h-8 items-center text-sm text-muted">
                          Quote requested
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setRenewFor(a)}
                          aria-label={`Request a renewal quote for ${a.serialNumber}`}
                        >
                          Request quote
                        </Button>
                      ))}
                    {canManage && sites.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setMoveFor(a)}
                        aria-label={`Change the site of ${a.serialNumber}`}
                      >
                        Change site
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Sites sites={sites} canManage={canManage} onChange={() => router.refresh()} />
      </div>

      <RenewDialog
        asset={renewFor}
        onClose={() => setRenewFor(null)}
        onDone={() => done(`Renewal quote requested for ${renewFor?.serialNumber}`)}
      />
      <MoveDialog
        asset={moveFor}
        sites={sites}
        onClose={() => setMoveFor(null)}
        onDone={() => {
          setMoveFor(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function RenewDialog({
  asset,
  onClose,
  onDone,
}: {
  asset: AssetSummary | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [tier, setTier] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!asset) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/v1/assets/${asset.id}/renewal-request`, {
        method: 'POST',
        body: {
          ...(tier ? { desiredTier: tier } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      setTier('');
      setNote('');
      onDone();
    } catch (e) {
      setErr(e instanceof ClientApiError ? (e.detail ?? e.title) : 'The request could not be sent');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!asset} onClose={onClose} title="Request a renewal quote">
      {asset && (
        <>
          <p className="text-sm text-muted">
            {asset.modelName}, serial <span className="font-mono">{asset.serialNumber}</span>. Our
            renewals team will email you a quote.
          </p>
          {err && <Notice tone="error">{err}</Notice>}
          <Field label="Support level" hint="Keep the current level or ask for a different one.">
            {(p) => (
              <Select {...p} value={tier} onChange={(e) => setTier(e.target.value)}>
                <option value="">Same as today</option>
                <option value="standard">Standard (business hours)</option>
                <option value="premium">Premium (extended hours)</option>
                <option value="mission_critical">Mission-Critical (24×7)</option>
              </Select>
            )}
          </Field>
          <Field label="Anything we should know">
            {(p) => (
              <Textarea
                {...p}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="For example: quote for 3 years, or add the spare unit at the DR site"
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button busy={busy} onClick={submit}>
              Request quote
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function MoveDialog({
  asset,
  sites,
  onClose,
  onDone,
}: {
  asset: AssetSummary | null;
  sites: SiteView[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [siteId, setSiteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!asset) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/v1/assets/${asset.id}`, {
        method: 'PATCH',
        body: { siteId: (siteId || asset.siteId) ?? null },
      });
      setSiteId('');
      onDone();
    } catch (e) {
      setErr(e instanceof ClientApiError ? (e.detail ?? e.title) : 'The device could not be moved');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!asset} onClose={onClose} title="Change site">
      {asset && (
        <>
          <p className="text-sm text-muted">
            Where is <span className="font-mono">{asset.serialNumber}</span> installed? Engineers
            use the site to plan visits and replacements.
          </p>
          {err && <Notice tone="error">{err}</Notice>}
          <Field label="Site">
            {(p) => (
              <Select
                {...p}
                value={siteId || asset.siteId || ''}
                onChange={(e) => setSiteId(e.target.value)}
              >
                <option value="" disabled>
                  Choose a site
                </option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.city ? `, ${s.city}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button busy={busy} onClick={save} disabled={!siteId || siteId === asset.siteId}>
              Save site
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function Sites({
  sites,
  canManage,
  onChange,
}: {
  sites: SiteView[];
  canManage: boolean;
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', city: '', state: '', pincode: '', address: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const add = async () => {
    setBusy('add');
    setErr(null);
    try {
      const body = Object.fromEntries(
        Object.entries(form)
          .map(([k, v]) => [k, v.trim()])
          .filter(([, v]) => v),
      );
      await apiFetch('/v1/sites', { method: 'POST', body });
      setForm({ name: '', city: '', state: '', pincode: '', address: '' });
      setAdding(false);
      onChange();
    } catch (e) {
      setErr(
        e instanceof ClientApiError
          ? (e.errors?.[0]?.message ?? e.detail ?? e.title)
          : 'The site could not be added',
      );
    } finally {
      setBusy(null);
    }
  };
  const remove = async (s: SiteView) => {
    setBusy(s.id);
    setErr(null);
    try {
      await apiFetch(`/v1/sites/${s.id}`, { method: 'DELETE' });
      onChange();
    } catch (e) {
      setErr(e instanceof ClientApiError ? (e.detail ?? e.title) : 'The site could not be removed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="sites-h" className="space-y-4">
      <h2 id="sites-h" className="text-lg font-semibold">
        Sites
      </h2>
      {err && <Notice tone="error">{err}</Notice>}
      {sites.length ? (
        <ul className="space-y-3 text-sm">
          {sites.map((s) => (
            <li
              key={s.id}
              className="flex items-start justify-between gap-3 border-b border-line pb-3"
            >
              <span>
                <span className="font-medium">{s.name}</span>
                <span className="block text-muted">
                  {[s.city, s.state].filter(Boolean).join(', ') || 'No address'} · {s.assetCount}{' '}
                  {s.assetCount === 1 ? 'device' : 'devices'}
                </span>
              </span>
              {canManage && s.assetCount === 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  busy={busy === s.id}
                  onClick={() => remove(s)}
                  aria-label={`Remove site ${s.name}`}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No sites yet.</p>
      )}
      {canManage &&
        (adding ? (
          <div className="space-y-3 rounded-m border border-line p-4">
            <Field label="Site name" required>
              {(p) => <Input {...p} maxLength={120} value={form.name} onChange={set('name')} />}
            </Field>
            <Field label="Address">
              {(p) => (
                <Input {...p} maxLength={300} value={form.address} onChange={set('address')} />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                {(p) => <Input {...p} maxLength={80} value={form.city} onChange={set('city')} />}
              </Field>
              <Field label="State">
                {(p) => <Input {...p} maxLength={80} value={form.state} onChange={set('state')} />}
              </Field>
            </div>
            <Field label="PIN code">
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  pattern="[1-9][0-9]{5}"
                  maxLength={6}
                  value={form.pincode}
                  onChange={set('pincode')}
                />
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button size="sm" busy={busy === 'add'} disabled={!form.name.trim()} onClick={add}>
                Add site
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            Add a site
          </Button>
        ))}
    </section>
  );
}
