'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SiteView, VisitKind, VisitSlots, VisitView } from '@wd/contracts';
import { Button, Dialog, Field, Input, Notice, Select, Textarea, cn } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
const hour = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
const dayName = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }).format(
    new Date(`${d}T12:00:00+05:30`),
  );
const KIND: Record<VisitKind, string> = { onsite: 'Engineer visit', remote: 'Remote session' };
const errText = (x: unknown, f: string) =>
  x instanceof ClientApiError ? (x.detail ?? x.title) : f;

/** Visits on a case: book a free slot (customers and engineers), add to calendar, cancel, mark done. */
export function VisitsPanel({
  number,
  open,
  staff,
  defaultContact,
}: {
  number: string;
  open: boolean;
  staff: boolean;
  defaultContact: string;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['visits', number],
    queryFn: () => apiFetch<{ items: VisitView[] }>(`/v1/cases/${number}/visits`),
  });
  const [booking, setBooking] = useState(false);
  const [cancelFor, setCancelFor] = useState<VisitView | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const items = q.data?.items ?? [];
  const upcoming = items.find((v) => v.status === 'booked' && Date.parse(v.endsAt) > Date.now());
  const set = (items: VisitView[]) => qc.setQueryData(['visits', number], { items });

  async function cancel() {
    if (!cancelFor) return;
    setBusy('cancel');
    try {
      set(
        (
          await apiFetch<{ items: VisitView[] }>(`/v1/visits/${cancelFor.id}/cancel`, {
            method: 'POST',
            body: { reason },
          })
        ).items,
      );
      setMsg({ tone: 'success', text: `${KIND[cancelFor.kind]} cancelled.` });
      setCancelFor(null);
      setReason('');
    } catch (x) {
      setMsg({ tone: 'error', text: errText(x, 'Could not cancel.') });
    } finally {
      setBusy(null);
    }
  }
  async function done(v: VisitView) {
    setBusy(v.id);
    try {
      set(
        (
          await apiFetch<{ items: VisitView[] }>(`/v1/visits/${v.id}/done`, {
            method: 'POST',
            body: {},
          })
        ).items,
      );
    } catch (x) {
      setMsg({ tone: 'error', text: errText(x, 'Could not update.') });
    } finally {
      setBusy(null);
    }
  }

  if (!open && items.length === 0) return null;
  return (
    <section aria-labelledby="visits" className="rounded-m border border-line bg-surface p-4">
      <h2 id="visits" className="font-semibold">
        Visits
      </h2>
      {msg && (
        <Notice tone={msg.tone} className="mt-2">
          {msg.text}
        </Notice>
      )}
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted">
          Need an engineer on site, or a remote session? Book a time that suits you.
        </p>
      ) : (
        <ul className="mt-2 space-y-3 text-sm">
          {items.map((v) => (
            <li key={v.id}>
              <p
                className={cn('font-medium', v.status === 'cancelled' && 'text-muted line-through')}
              >
                {KIND[v.kind]}, {when(v.startsAt)}
              </p>
              <p className="text-muted">
                {v.status === 'cancelled'
                  ? `Cancelled: ${v.cancelReason ?? ''}`
                  : v.status === 'done'
                    ? 'Done'
                    : `${v.engineerName ?? 'Engineer to be confirmed'}${v.siteName ? `, ${v.siteName}` : ''}`}
              </p>
              {v.status === 'booked' && (
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  <a
                    className="text-teal-ink underline underline-offset-2"
                    href={`/api/v1/visits/${v.id}/calendar.ics`}
                  >
                    Add to calendar
                  </a>
                  <button
                    type="button"
                    className="text-teal-ink underline underline-offset-2"
                    onClick={() => setCancelFor(v)}
                  >
                    Cancel
                  </button>
                  {staff && Date.parse(v.startsAt) <= Date.now() && (
                    <button
                      type="button"
                      className="text-teal-ink underline underline-offset-2"
                      disabled={busy === v.id}
                      onClick={() => done(v)}
                    >
                      Mark done
                    </button>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && !upcoming && (
        <Button className="mt-3" size="sm" variant="secondary" onClick={() => setBooking(true)}>
          Book a visit or session
        </Button>
      )}
      <BookDialog
        open={booking}
        number={number}
        defaultContact={defaultContact}
        onClose={() => setBooking(false)}
        onBooked={(items) => {
          set(items);
          setBooking(false);
          const v = items.find((x) => x.status === 'booked');
          setMsg({
            tone: 'success',
            text: v
              ? `${KIND[v.kind]} booked for ${when(v.startsAt)}. We have emailed the details.`
              : 'Booked.',
          });
        }}
      />
      <Dialog open={!!cancelFor} onClose={() => setCancelFor(null)} title="Cancel this booking">
        <Field label="Why are you cancelling?" required>
          {(a) => (
            <Textarea
              {...a}
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCancelFor(null)}>
            Keep it
          </Button>
          <Button busy={busy === 'cancel'} disabled={reason.trim().length < 3} onClick={cancel}>
            Cancel booking
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

function BookDialog({
  open,
  number,
  defaultContact,
  onClose,
  onBooked,
}: {
  open: boolean;
  number: string;
  defaultContact: string;
  onClose: () => void;
  onBooked: (items: VisitView[]) => void;
}) {
  const [kind, setKind] = useState<VisitKind>('onsite');
  const [startsAt, setStartsAt] = useState('');
  const [f, setF] = useState({
    contactName: defaultContact,
    contactPhone: '',
    siteId: '',
    notes: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const slots = useQuery({
    queryKey: ['visit-slots', number, kind],
    queryFn: () => apiFetch<VisitSlots>(`/v1/cases/${number}/visit-slots?kind=${kind}`),
    enabled: open,
  });
  const sites = useQuery({
    queryKey: ['sites'],
    queryFn: () => apiFetch<{ items: SiteView[] }>('/v1/sites'),
    enabled: open && kind === 'onsite',
  });

  async function book() {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<{ items: VisitView[] }>(`/v1/cases/${number}/visits`, {
        method: 'POST',
        body: {
          kind,
          startsAt,
          contactName: f.contactName.trim(),
          contactPhone: f.contactPhone.trim(),
          ...(kind === 'onsite' ? { siteId: f.siteId } : {}),
          ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
        },
      });
      onBooked(r.items);
      setStartsAt('');
    } catch (x) {
      setErr(errText(x, 'Could not book that time.'));
      void slots.refetch();
    } finally {
      setBusy(false);
    }
  }

  const days = slots.data?.days ?? [];
  return (
    <Dialog open={open} onClose={onClose} title="Book a visit or session">
      <fieldset className="flex gap-4 text-sm">
        <legend className="mb-1 font-medium">What do you need?</legend>
        {(['onsite', 'remote'] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input
              type="radio"
              name="kind"
              checked={kind === k}
              onChange={() => {
                setKind(k);
                setStartsAt('');
              }}
            />
            {k === 'onsite' ? 'An engineer on site (2 hours)' : 'A remote session (1 hour)'}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Choose a time (India time)</legend>
        {slots.isLoading ? (
          <p className="text-sm text-muted">Finding free times…</p>
        ) : days.length === 0 ? (
          <p className="text-sm text-muted">
            No free times in the next ten days. Call the support line and we will arrange one.
          </p>
        ) : (
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {days.map((d) => (
              <div key={d.day}>
                <p className="text-sm text-muted">{dayName(d.day)}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {d.slots.map((s) => (
                    <label
                      key={s.startsAt}
                      className={cn(
                        'cursor-pointer rounded-s border px-2.5 py-1 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
                        startsAt === s.startsAt
                          ? 'border-navy bg-navy text-white dark:border-teal dark:bg-teal dark:text-navy'
                          : 'border-line',
                      )}
                    >
                      <input
                        type="radio"
                        name="slot"
                        className="sr-only"
                        checked={startsAt === s.startsAt}
                        onChange={() => setStartsAt(s.startsAt)}
                      />
                      {hour(s.startsAt)}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </fieldset>
      {kind === 'onsite' && (
        <Field label="Site" required>
          {(a) => (
            <Select
              {...a}
              value={f.siteId}
              onChange={(e) => setF({ ...f, siteId: e.target.value })}
            >
              <option value="">Choose a site</option>
              {(sites.data?.items ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Contact on the day" required>
          {(a) => (
            <Input
              {...a}
              value={f.contactName}
              onChange={(e) => setF({ ...f, contactName: e.target.value })}
            />
          )}
        </Field>
        <Field label="Their phone" required>
          {(a) => (
            <Input
              {...a}
              type="tel"
              value={f.contactPhone}
              onChange={(e) => setF({ ...f, contactPhone: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field
        label="Anything the engineer should know"
        hint="For example: gate pass, rack location, access hours."
      >
        {(a) => (
          <Textarea
            {...a}
            rows={2}
            maxLength={1000}
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        )}
      </Field>
      {err && <Notice tone="error">{err}</Notice>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          busy={busy}
          disabled={
            !startsAt ||
            f.contactName.trim().length < 2 ||
            f.contactPhone.trim().length < 8 ||
            (kind === 'onsite' && !f.siteId)
          }
          onClick={book}
        >
          Book this time
        </Button>
      </div>
    </Dialog>
  );
}
