'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RMA_STATUS_LABELS, type RmaSummary } from '@wd/contracts';
import { Button, Dialog, Field, Input, Notice, Select, Textarea } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

/** RMAs on a case, and the request form. Shown in the case sidebar. */
export function RmaPanel({
  caseNumber,
  base,
  canRequest,
  caseOpen,
}: {
  caseNumber: string;
  base: '/portal/rmas' | '/workspace/rmas';
  canRequest: boolean;
  caseOpen: boolean;
}) {
  const qc = useQueryClient();
  const key = ['rmas', caseNumber];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () =>
      apiFetch<{ items: RmaSummary[] }>(`/v1/rmas?case=${encodeURIComponent(caseNumber)}`),
  });
  const [open, setOpen] = useState(false);
  const items = data?.items ?? [];
  if (!items.length && !(canRequest && caseOpen)) return null;
  return (
    <section aria-labelledby="rma-h" className="text-sm">
      <h2 id="rma-h" className="font-semibold">
        Replacement (RMA)
      </h2>
      {items.length > 0 && (
        <ul className="mt-2 space-y-1">
          {items.map((r) => (
            <li key={r.id} className="flex justify-between gap-2">
              <Link
                href={`${base}/${r.number}`}
                className="font-mono text-teal-ink underline underline-offset-2"
              >
                {r.number}
              </Link>
              <span className="text-muted">{RMA_STATUS_LABELS[r.status]}</span>
            </li>
          ))}
        </ul>
      )}
      {canRequest && caseOpen && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setOpen(true)}>
          Request a replacement
        </Button>
      )}
      <RequestDialog
        open={open}
        caseNumber={caseNumber}
        onClose={() => setOpen(false)}
        onDone={() => {
          setOpen(false);
          void qc.invalidateQueries({ queryKey: key });
          void qc.invalidateQueries({ queryKey: ['case', caseNumber] });
        }}
      />
    </section>
  );
}

function RequestDialog({
  open,
  caseNumber,
  onClose,
  onDone,
}: {
  open: boolean;
  caseNumber: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    type: 'standard',
    faultDescription: '',
    contactName: '',
    contactPhone: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    setBusy(true);
    setErr(null);
    setFieldErr({});
    try {
      await apiFetch(`/v1/cases/${caseNumber}/rmas`, { method: 'POST', body: f });
      onDone();
    } catch (e) {
      if (e instanceof ClientApiError) {
        setErr(e.detail ?? e.title);
        setFieldErr(Object.fromEntries((e.errors ?? []).map((x) => [x.path, x.message])));
      } else setErr('The request could not be sent');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Request a replacement">
      <p className="text-sm text-muted">
        Use this when troubleshooting points to faulty hardware. An RMA coordinator reviews every
        request.
      </p>
      {err && <Notice tone="error">{err}</Notice>}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Replacement type"
          hint="Advance replacement needs Premium or Mission-Critical coverage."
        >
          {(p) => (
            <Select {...p} value={f.type} onChange={set('type')}>
              <option value="standard">Return the faulty unit, then we ship the replacement</option>
              <option value="advance">Advance replacement: we ship first</option>
            </Select>
          )}
        </Field>
        <Field label="What is wrong with the hardware" required error={fieldErr.faultDescription}>
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              maxLength={4000}
              value={f.faultDescription}
              onChange={set('faultDescription')}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact name" required error={fieldErr.contactName}>
            {(p) => (
              <Input
                {...p}
                autoComplete="name"
                value={f.contactName}
                onChange={set('contactName')}
              />
            )}
          </Field>
          <Field label="Contact phone" required error={fieldErr.contactPhone}>
            {(p) => (
              <Input
                {...p}
                type="tel"
                autoComplete="tel"
                value={f.contactPhone}
                onChange={set('contactPhone')}
              />
            )}
          </Field>
        </div>
        <Field label="Delivery address" required error={fieldErr.address}>
          {(p) => (
            <Input
              {...p}
              autoComplete="street-address"
              value={f.address}
              onChange={set('address')}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City" required error={fieldErr.city}>
            {(p) => <Input {...p} value={f.city} onChange={set('city')} />}
          </Field>
          <Field label="State" required error={fieldErr.state}>
            {(p) => <Input {...p} value={f.state} onChange={set('state')} />}
          </Field>
          <Field label="PIN code" required error={fieldErr.pincode}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                maxLength={6}
                value={f.pincode}
                onChange={set('pincode')}
              />
            )}
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Send request
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
