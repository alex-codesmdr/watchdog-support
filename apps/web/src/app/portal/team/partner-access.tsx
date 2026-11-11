'use client';
import { useState } from 'react';
import type { DelegationView } from '@wd/contracts';
import { Button, Notice } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );

/** Partners (resellers) that may act for this organisation, with a way to end their access. */
export function PartnerAccess({ initial }: { initial: DelegationView[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  async function end(d: DelegationView) {
    setBusy(d.id);
    setMsg(null);
    try {
      const r = await apiFetch<{ items: DelegationView[] }>(`/v1/org/partners/${d.id}/revoke`, {
        method: 'POST',
        body: {},
      });
      setItems(r.items);
      setMsg({ tone: 'success', text: `${d.partnerName} no longer has access.` });
    } catch (x) {
      setMsg({
        tone: 'error',
        text: x instanceof ClientApiError ? (x.detail ?? x.title) : 'Could not end access.',
      });
    } finally {
      setBusy(null);
    }
  }
  return (
    <section aria-labelledby="partners" className="space-y-3">
      <h2 id="partners" className="text-lg font-semibold">
        Partners who can act for you
      </h2>
      <p className="max-w-prose text-sm text-muted">
        A partner on this list can open and follow your cases and see your devices, but not your
        contracts or invoices. WatchDog Support adds partners; you can end their access here.
      </p>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {items.length === 0 ? (
        <p className="text-sm text-muted">No partner has access.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {items.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span>
                <span className="font-medium">{d.partnerName}</span>
                <span className="block text-sm text-muted">
                  Since {fmt(d.since)}
                  {d.expiresAt ? `, until ${fmt(d.expiresAt)}` : ''}
                </span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                busy={busy === d.id}
                onClick={() => end(d)}
                aria-label={`End access for ${d.partnerName}`}
              >
                End access
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
