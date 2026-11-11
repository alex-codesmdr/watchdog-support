'use client';
import { useState } from 'react';
import type { DelegationView } from '@wd/contracts';
import { Button, Field, Input, Notice, Select } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );

export function PartnersAdmin({
  partners,
  customers,
  delegations,
}: {
  partners: { id: string; name: string }[];
  customers: { id: string; name: string }[];
  delegations: DelegationView[];
}) {
  const [items, setItems] = useState(delegations);
  const [f, setF] = useState({ partnerOrgId: '', customerOrgId: '', expiresOn: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  async function call(key: string, path: string, body: unknown, done: string) {
    setBusy(key);
    setMsg(null);
    try {
      setItems(
        (await apiFetch<{ delegations: DelegationView[] }>(path, { method: 'POST', body }))
          .delegations,
      );
      setMsg({ tone: 'success', text: done });
      return true;
    } catch (x) {
      setMsg({
        tone: 'error',
        text: x instanceof ClientApiError ? (x.detail ?? x.title) : 'That did not work.',
      });
      return false;
    } finally {
      setBusy(null);
    }
  }
  const active = items.filter(
    (d) => !d.revokedAt && (!d.expiresAt || Date.parse(d.expiresAt) > Date.now()),
  );
  const past = items.filter((d) => !active.includes(d));
  const name = (list: { id: string; name: string }[], id: string) =>
    list.find((x) => x.id === id)?.name ?? '';
  return (
    <div className="space-y-8">
      <form
        className="space-y-4 rounded-m border border-line bg-surface p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await call(
              'grant',
              '/v1/admin/partners/delegations',
              { ...f, expiresOn: f.expiresOn || null },
              `${name(partners, f.partnerOrgId)} can now act for ${name(customers, f.customerOrgId)}.`,
            )
          )
            setF({ partnerOrgId: '', customerOrgId: '', expiresOn: '' });
        }}
      >
        <h2 className="font-semibold">Give a partner access</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Partner" required>
            {(a) => (
              <Select
                {...a}
                value={f.partnerOrgId}
                onChange={(e) => setF({ ...f, partnerOrgId: e.target.value })}
              >
                <option value="">Choose a partner</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Customer" required>
            {(a) => (
              <Select
                {...a}
                value={f.customerOrgId}
                onChange={(e) => setF({ ...f, customerOrgId: e.target.value })}
              >
                <option value="">Choose a customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Until" hint="Leave empty for no end date.">
            {(a) => (
              <Input
                {...a}
                type="date"
                value={f.expiresOn}
                onChange={(e) => setF({ ...f, expiresOn: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Button
          type="submit"
          busy={busy === 'grant'}
          disabled={!f.partnerOrgId || !f.customerOrgId}
        >
          Give access
        </Button>
      </form>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <section aria-labelledby="active" className="space-y-2">
        <h2 id="active" className="text-lg font-semibold">
          Current access
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted">No partner has access to any customer.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {active.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  <span className="font-medium">{d.partnerName}</span> for{' '}
                  <span className="font-medium">{d.customerName}</span>
                  <span className="block text-sm text-muted">
                    Since {fmt(d.since)}
                    {d.grantedBy ? `, given by ${d.grantedBy}` : ''}
                    {d.expiresAt ? `, until ${fmt(d.expiresAt)}` : ''}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  busy={busy === d.id}
                  onClick={() =>
                    call(
                      d.id,
                      `/v1/admin/partners/delegations/${d.id}/revoke`,
                      {},
                      `Access ended for ${d.partnerName}.`,
                    )
                  }
                  aria-label={`End ${d.partnerName}'s access to ${d.customerName}`}
                >
                  End access
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-teal-ink">
            Ended access ({past.length})
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {past.map((d) => (
              <li key={d.id}>
                {d.partnerName} for {d.customerName}, {fmt(d.since)} to{' '}
                {fmt(d.revokedAt ?? d.expiresAt ?? d.since)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
