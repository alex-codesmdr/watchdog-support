'use client';
import { useState } from 'react';
import type { ContractView, InvoiceView } from '@wd/contracts';
import { Button, Dialog, EmptyState, Field, Notice, Textarea, cn } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

export const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
export const fmtDay = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${d}T00:00:00`),
  );
const INVOICE: Record<InvoiceView['status'], { label: string; cls: string }> = {
  issued: { label: 'Due', cls: 'text-ink' },
  overdue: { label: 'Overdue', cls: 'font-semibold text-danger' },
  paid: { label: 'Paid', cls: 'text-ok' },
  cancelled: { label: 'Cancelled', cls: 'text-muted line-through' },
};

export function endsLabel(days: number, endsOn: string) {
  if (days < 0) return { text: `Ended ${fmtDay(endsOn)}`, cls: 'text-danger' };
  if (days <= 90) return { text: `Ends ${fmtDay(endsOn)}, in ${days} days`, cls: 'text-amber-ink' };
  return { text: `Until ${fmtDay(endsOn)}`, cls: 'text-ink' };
}

export function Contracts({ initial, canRenew }: { initial: ContractView[]; canRenew: boolean }) {
  const [items, setItems] = useState(initial);
  const [ask, setAsk] = useState<ContractView | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function send() {
    if (!ask) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ items: ContractView[] }>(
        `/v1/contracts/${ask.id}/renewal-request`,
        {
          method: 'POST',
          body: note.trim() ? { note: note.trim() } : {},
        },
      );
      setItems(r.items);
      setMsg({
        tone: 'success',
        text: `Renewal requested for ${ask.ref}. Your account manager will send a quote.`,
      });
      setAsk(null);
      setNote('');
    } catch (x) {
      setMsg({
        tone: 'error',
        text: x instanceof ClientApiError ? (x.detail ?? x.title) : 'Could not send the request.',
      });
      setAsk(null);
    } finally {
      setBusy(false);
    }
  }

  if (!items.length)
    return (
      <EmptyState title="No contracts on record yet">
        Your account manager adds contracts here. Coverage for each device is on the Devices page.
      </EmptyState>
    );
  return (
    <div className="space-y-6">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {items.map((c) => {
        const e = endsLabel(c.daysLeft, c.endsOn);
        return (
          <section
            key={c.id}
            aria-labelledby={`c-${c.id}`}
            className="rounded-m border border-line bg-surface p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id={`c-${c.id}`} className="text-lg font-semibold">
                  {c.title}
                </h2>
                <p className="text-sm text-muted">Contract {c.ref}</p>
              </div>
              <p className="text-right">
                <span className="block text-xl font-semibold tabular-nums">{inr(c.valueInr)}</span>
                <span className="text-sm text-muted">
                  {fmtDay(c.startsOn)} to {fmtDay(c.endsOn)}
                </span>
              </p>
            </div>
            <p className={cn('mt-3 text-sm', e.cls)}>{e.text}</p>
            <div className="mt-3">
              {c.renewalRequested ? (
                <p className="text-sm text-muted">
                  Renewal requested. Your account manager will send a quote.
                </p>
              ) : (
                canRenew &&
                c.daysLeft <= 120 && (
                  <Button size="sm" variant="secondary" onClick={() => setAsk(c)}>
                    Ask to renew {c.ref}
                  </Button>
                )
              )}
            </div>
            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold">Devices covered ({c.devices.length})</h3>
                {c.devices.length ? (
                  <ul className="mt-2 space-y-1 text-sm">
                    {c.devices.map((d) => (
                      <li key={d.serialNumber}>
                        <span className="font-mono">{d.serialNumber}</span>{' '}
                        <span className="text-muted">
                          {d.modelName}
                          {d.siteName ? `, ${d.siteName}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted">No devices linked to this contract yet.</p>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold">Invoices</h3>
                {c.invoices.length ? (
                  <table className="mt-2 w-full text-left text-sm">
                    <thead className="text-muted">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Invoice</th>
                        <th className="py-1 pr-3 font-medium">Due</th>
                        <th className="py-1 pr-3 text-right font-medium">Amount</th>
                        <th className="py-1 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.invoices.map((i) => (
                        <tr key={i.id} className="border-t border-line">
                          <td className="py-1 pr-3">{i.number}</td>
                          <td className="py-1 pr-3">{fmtDay(i.dueOn)}</td>
                          <td className="py-1 pr-3 text-right tabular-nums">{inr(i.amountInr)}</td>
                          <td className={cn('py-1', INVOICE[i.status].cls)}>
                            {INVOICE[i.status].label}
                            {i.paidOn ? ` ${fmtDay(i.paidOn)}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="mt-2 text-sm text-muted">No invoices yet.</p>
                )}
              </div>
            </div>
          </section>
        );
      })}
      <Dialog
        open={!!ask}
        onClose={() => setAsk(null)}
        title={ask ? `Renew contract ${ask.ref}` : 'Renew'}
      >
        <p className="text-sm text-muted">
          Your account manager gets your request and sends a renewal quote. Nothing is charged until
          you accept it.
        </p>
        <Field
          label="Anything we should know"
          hint="For example: number of years, devices to add or remove."
        >
          {(a) => (
            <Textarea
              {...a}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setAsk(null)}>
            Cancel
          </Button>
          <Button busy={busy} onClick={send}>
            Ask for a quote
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
