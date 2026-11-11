'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  RENEWAL_STAGES,
  RENEWAL_STAGE_LABELS,
  type RenewalPipeline,
  type RenewalStage,
} from '@wd/contracts';
import { Button, EmptyState, Notice, Select, cn } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
const fmtDay = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${d}T00:00:00`),
  );

export function Pipeline({ p, days }: { p: RenewalPipeline; days: number }) {
  const [items, setItems] = useState(p.items);
  const [edit, setEdit] = useState<Record<string, { stage: RenewalStage; note: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function save(id: string) {
    const e = edit[id]!;
    setBusy(id);
    setMsg(null);
    try {
      await apiFetch(`/v1/workspace/renewals/${id}`, {
        method: 'PUT',
        body: { stage: e.stage, note: e.note },
      });
      setItems((xs) =>
        xs.map((x) =>
          x.contractId === id
            ? {
                ...x,
                stage: e.stage,
                note: e.note || null,
                customerAsked: x.customerAsked && !['quoted', 'won', 'lost'].includes(e.stage),
              }
            : x,
        ),
      );
      setEdit(({ [id]: _, ...rest }) => rest);
      setMsg({ tone: 'success', text: 'Saved.' });
    } catch (x) {
      setMsg({
        tone: 'error',
        text: x instanceof ClientApiError ? (x.detail ?? x.title) : 'Could not save.',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-6 sm:grid-cols-3">
        <div className="border-l-2 border-line pl-3">
          <dt className="text-sm text-muted">Open renewals</dt>
          <dd className="text-2xl font-semibold tabular-nums">{p.totals.count}</dd>
        </div>
        <div className="border-l-2 border-line pl-3">
          <dt className="text-sm text-muted">Value still open</dt>
          <dd className="text-2xl font-semibold tabular-nums">{inr(p.totals.openValueInr)}</dd>
        </div>
        <div className="border-l-2 border-line pl-3">
          <dt className="text-sm text-muted">Renewed</dt>
          <dd className="text-2xl font-semibold tabular-nums">{inr(p.totals.wonValueInr)}</dd>
        </div>
      </dl>
      <nav aria-label="Period" className="flex flex-wrap gap-x-4 text-sm">
        {[30, 60, 90, 180, 365].map((d) => (
          <Link
            key={d}
            href={`/workspace/renewals?days=${d}`}
            aria-current={d === days ? 'page' : undefined}
            className={cn(
              'underline-offset-2',
              d === days ? 'font-semibold' : 'text-teal-ink underline',
            )}
          >
            Next {d} days
          </Link>
        ))}
      </nav>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {items.length === 0 ? (
        <EmptyState title="Nothing to renew in this period" />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {items.map((i) => {
            const key = i.contractId ?? `org-${i.orgId}`;
            const e = i.contractId
              ? (edit[i.contractId] ?? { stage: i.stage ?? 'not_started', note: i.note ?? '' })
              : null;
            const dirty = i.contractId && edit[i.contractId];
            return (
              <li
                key={key}
                className="grid gap-3 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
              >
                <div>
                  <p className="font-semibold">{i.orgName}</p>
                  <p className="text-sm">
                    {i.title}
                    {i.ref ? ` (${i.ref})` : ''}, {i.devices} device{i.devices === 1 ? '' : 's'}
                  </p>
                  <p
                    className={cn(
                      'text-sm',
                      i.daysLeft < 0
                        ? 'text-danger'
                        : i.daysLeft <= 30
                          ? 'text-amber-ink'
                          : 'text-muted',
                    )}
                  >
                    {i.daysLeft < 0
                      ? `Ended ${fmtDay(i.endsOn)}, ${-i.daysLeft} days ago`
                      : `Ends ${fmtDay(i.endsOn)}, in ${i.daysLeft} days`}
                    {i.valueInr !== null ? `. ${inr(i.valueInr)}` : ''}
                  </p>
                  <p className="text-sm text-muted">
                    Owner: {i.ownerName ?? 'nobody yet'}
                    {i.customerAsked && (
                      <span className="ml-2 font-medium text-ink">
                        The customer asked to renew.
                      </span>
                    )}
                  </p>
                </div>
                {e && i.contractId ? (
                  <div className="space-y-2">
                    <label className="flex flex-col gap-1 text-sm font-medium">
                      Stage
                      <Select
                        value={e.stage}
                        onChange={(ev) =>
                          setEdit({
                            ...edit,
                            [i.contractId!]: { ...e, stage: ev.target.value as RenewalStage },
                          })
                        }
                      >
                        {RENEWAL_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {RENEWAL_STAGE_LABELS[s]}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium">
                      Note
                      <input
                        className="h-10 rounded-s border border-line bg-surface px-3 font-normal"
                        value={e.note}
                        maxLength={2000}
                        onChange={(ev) =>
                          setEdit({ ...edit, [i.contractId!]: { ...e, note: ev.target.value } })
                        }
                      />
                    </label>
                    {dirty && (
                      <Button
                        size="sm"
                        busy={busy === i.contractId}
                        onClick={() => save(i.contractId!)}
                      >
                        Save
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted">
                    No contract on record.{' '}
                    <Link
                      className="text-teal-ink underline underline-offset-2"
                      href="/admin/contracts"
                    >
                      Add the contract
                    </Link>{' '}
                    to track its value and stage.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
