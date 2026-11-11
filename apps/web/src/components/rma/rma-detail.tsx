'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  RMA_OPEN,
  RMA_STATUS_LABELS,
  RMA_TYPE_LABELS,
  type RmaStatus,
  type RmaView,
} from '@wd/contracts';
import { Button, Field, Input, Notice, StatusPill, Textarea } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

/** Action label per target status; customers and coordinators see the same words. */
const ACTION: Record<RmaStatus, string> = {
  requested: 'Request',
  approved: 'Approve',
  rejected: 'Decline',
  cancelled: 'Cancel this RMA',
  return_in_transit: 'Faulty unit sent',
  received: 'Mark faulty unit received',
  replacement_shipped: 'Ship replacement',
  closed: 'Close RMA',
};
/** Which fields an action needs. */
const NEEDS: Partial<Record<RmaStatus, Array<'tracking' | 'serial' | 'note'>>> = {
  return_in_transit: ['tracking'],
  replacement_shipped: ['serial', 'tracking'],
  rejected: ['note'],
};

export function RmaDetail({
  initial,
  staff,
  caseBase,
}: {
  initial: RmaView;
  staff: boolean;
  caseBase: string;
}) {
  const [r, setR] = useState(initial);
  const [action, setAction] = useState<RmaStatus | null>(null);
  const [f, setF] = useState({ courier: '', trackingNumber: '', replacementSerial: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = RMA_OPEN.includes(r.status);

  const submit = async (to: RmaStatus) => {
    setBusy(true);
    setErr(null);
    const need = NEEDS[to] ?? [];
    const body: Record<string, string> = { to };
    if (need.includes('tracking')) {
      body.trackingNumber = f.trackingNumber.trim();
      if (f.courier.trim()) body.courier = f.courier.trim();
    }
    if (need.includes('serial')) body.replacementSerial = f.replacementSerial.trim();
    if (f.note.trim()) body.note = f.note.trim();
    try {
      setR(await apiFetch<RmaView>(`/v1/rmas/${r.number}/transition`, { method: 'POST', body }));
      setAction(null);
      setF({ courier: '', trackingNumber: '', replacementSerial: '', note: '' });
    } catch (e) {
      setErr(
        e instanceof ClientApiError
          ? (e.errors?.map((x) => x.message).join('; ') ?? e.detail ?? e.title)
          : 'That did not work. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const need = action ? (NEEDS[action] ?? []) : [];
  // Cancelling or declining as a coordinator needs a reason for the customer.
  const noteRequired = action === 'rejected' || (staff && action === 'cancelled');

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_19rem]">
      <div className="min-w-0 space-y-8">
        <header>
          <p className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <span className="font-mono">{r.number}</span>
            <StatusPill label={RMA_STATUS_LABELS[r.status]} open={open} />
            <span>{RMA_TYPE_LABELS[r.type]}</span>
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            {r.modelName} <span className="font-mono text-xl font-normal">{r.serialNumber}</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            {staff && <>{r.org.name}. </>}From case{' '}
            <Link
              href={`${caseBase}/${r.caseNumber}`}
              className="font-mono text-teal-ink underline underline-offset-2"
            >
              {r.caseNumber}
            </Link>
          </p>
        </header>

        {err && <Notice tone="error">{err}</Notice>}

        {r.next.length > 0 && (
          <section aria-labelledby="next-h" className="rounded-m border border-line bg-surface p-4">
            <h2 id="next-h" className="font-semibold">
              Next step
            </h2>
            {r.status === 'approved' && !staff && r.type === 'standard' && (
              <p className="mt-1 text-sm text-muted">
                Download the RMA form, pack it with the faulty unit, and enter the tracking number
                once the courier has collected it.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {r.next.map((to) => (
                <Button
                  key={to}
                  size="sm"
                  variant={
                    to === 'cancelled' || to === 'rejected'
                      ? 'ghost'
                      : action === to
                        ? 'primary'
                        : 'secondary'
                  }
                  aria-pressed={action === to}
                  onClick={() =>
                    (NEEDS[to] ?? []).length || to === 'cancelled'
                      ? setAction(action === to ? null : to)
                      : void submit(to)
                  }
                  busy={busy && action === null}
                >
                  {ACTION[to]}
                </Button>
              ))}
            </div>
            {action && (
              <form
                className="mt-4 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit(action);
                }}
              >
                {need.includes('serial') && staff && (
                  <SparePicker
                    number={r.number}
                    onPick={(serial) => setF({ ...f, replacementSerial: serial })}
                  />
                )}
                {need.includes('serial') && (
                  <Field label="Replacement serial number" required>
                    {(p) => (
                      <Input
                        {...p}
                        className="font-mono uppercase"
                        value={f.replacementSerial}
                        onChange={(e) => setF({ ...f, replacementSerial: e.target.value })}
                      />
                    )}
                  </Field>
                )}
                {need.includes('tracking') && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Courier">
                      {(p) => (
                        <Input
                          {...p}
                          value={f.courier}
                          onChange={(e) => setF({ ...f, courier: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label="Tracking number" required>
                      {(p) => (
                        <Input
                          {...p}
                          className="font-mono"
                          value={f.trackingNumber}
                          onChange={(e) => setF({ ...f, trackingNumber: e.target.value })}
                        />
                      )}
                    </Field>
                  </div>
                )}
                <Field
                  label={noteRequired ? 'Reason for the customer' : 'Note (optional)'}
                  required={noteRequired}
                >
                  {(p) => (
                    <Textarea
                      {...p}
                      rows={2}
                      maxLength={2000}
                      value={f.note}
                      onChange={(e) => setF({ ...f, note: e.target.value })}
                    />
                  )}
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" busy={busy}>
                    {ACTION[action]}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAction(null)}>
                    Back
                  </Button>
                </div>
              </form>
            )}
          </section>
        )}

        <section aria-labelledby="hist-h">
          <h2 id="hist-h" className="font-semibold">
            History
          </h2>
          <ol className="mt-3 space-y-3 border-l border-line pl-4">
            {r.events.map((e, i) => (
              <li key={i} className="text-sm">
                <p>
                  <span className="font-medium">{RMA_STATUS_LABELS[e.to]}</span>{' '}
                  <span className="text-muted">
                    {fmt(e.at)} IST, {e.actor}
                  </span>
                </p>
                {e.note && <p className="mt-0.5 text-muted">“{e.note}”</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="space-y-6 text-sm">
        <a
          href={`/api/v1/rmas/${r.number}/form.pdf`}
          className="inline-flex h-10 items-center rounded-s border border-line bg-surface px-4 font-semibold text-ink hover:border-navy/40"
        >
          Download RMA form (PDF)
        </a>
        <section aria-labelledby="fault-h">
          <h2 id="fault-h" className="font-semibold">
            Reported fault
          </h2>
          <p className="mt-1 whitespace-pre-wrap">{r.faultDescription}</p>
        </section>
        <section aria-labelledby="ship-h">
          <h2 id="ship-h" className="font-semibold">
            Replacement ships to
          </h2>
          <p className="mt-1">
            {r.shipTo.contactName}, {r.shipTo.contactPhone}
            <br />
            {r.shipTo.address}
            <br />
            {r.shipTo.city}, {r.shipTo.state} {r.shipTo.pincode}
          </p>
        </section>
        <section aria-labelledby="track-h">
          <h2 id="track-h" className="font-semibold">
            Shipments
          </h2>
          <dl className="mt-1 grid grid-cols-[8rem_1fr] gap-y-1">
            <dt className="text-muted">Faulty unit</dt>
            <dd className="font-mono">
              {r.inbound.trackingNumber
                ? `${r.inbound.courier ? `${r.inbound.courier} ` : ''}${r.inbound.trackingNumber}`
                : '—'}
            </dd>
            <dt className="text-muted">Replacement</dt>
            <dd className="font-mono">
              {r.replacementSerial ? `${r.replacementSerial}, ` : ''}
              {r.outbound.trackingNumber
                ? `${r.outbound.courier ? `${r.outbound.courier} ` : ''}${r.outbound.trackingNumber}`
                : '—'}
            </dd>
          </dl>
        </section>
      </aside>
    </div>
  );
}

/** Spare units of the same model in stock, by depot: pick one to fill in the serial number. */
function SparePicker({ number, onPick }: { number: string; onPick: (serial: string) => void }) {
  const q = useQuery({
    queryKey: ['rma-spares', number],
    queryFn: () =>
      apiFetch<{ depots: { depotId: string; name: string; city: string; serials: string[] }[] }>(
        `/v1/workspace/stock/for-rma/${number}`,
      ),
  });
  if (!q.data) return null;
  if (!q.data.depots.length)
    return <p className="text-sm text-muted">No spare of this model in stock at any depot.</p>;
  return (
    <div className="text-sm">
      <p className="font-medium">Spares in stock</p>
      <ul className="mt-1 space-y-1">
        {q.data.depots.map((d) => (
          <li key={d.depotId}>
            <span className="text-muted">{d.name}:</span>{' '}
            {d.serials.map((s) => (
              <button
                key={s}
                type="button"
                className="mr-2 font-mono text-teal-ink underline underline-offset-2"
                onClick={() => onPick(s)}
              >
                {s}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
