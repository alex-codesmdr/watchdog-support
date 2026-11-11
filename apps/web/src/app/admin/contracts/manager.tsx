'use client';
import { useState } from 'react';
import type { ContractView, Engineer } from '@wd/contracts';
import { Button, Field, Input, Notice, Select, cn } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
const empty = {
  orgId: '',
  ref: '',
  title: '',
  valueInr: '',
  startsOn: '',
  endsOn: '',
  ownerId: '',
};
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export function ContractsAdmin({
  initial,
  orgs,
  staff,
}: {
  initial: ContractView[];
  orgs: { id: string; name: string }[];
  staff: Engineer[];
}) {
  const [items, setItems] = useState(initial);
  const [f, setF] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [inv, setInv] = useState<
    Record<string, { number: string; issuedOn: string; dueOn: string; amountInr: string }>
  >({});
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const fail = (x: unknown) =>
    setMsg({
      tone: 'error',
      text: x instanceof ClientApiError ? (x.detail ?? x.title) : 'That did not work.',
    });
  const upsert = (c: ContractView) =>
    setItems((xs) =>
      xs.some((x) => x.id === c.id) ? xs.map((x) => (x.id === c.id ? c : x)) : [...xs, c],
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    setMsg(null);
    try {
      const body = { ...f, valueInr: Number(f.valueInr), ownerId: f.ownerId || null };
      const c = await apiFetch<ContractView>(
        editing ? `/v1/admin/contracts/${editing}` : '/v1/admin/contracts',
        {
          method: editing ? 'PUT' : 'POST',
          body,
        },
      );
      upsert(c);
      setMsg({ tone: 'success', text: `${editing ? 'Saved' : 'Added'} contract ${c.ref}.` });
      setF(empty);
      setEditing(null);
    } catch (x) {
      fail(x);
    } finally {
      setBusy(null);
    }
  }
  async function addInvoice(c: ContractView) {
    const v = inv[c.id];
    if (!v) return;
    setBusy(`inv-${c.id}`);
    try {
      upsert(
        await apiFetch<ContractView>(`/v1/admin/contracts/${c.id}/invoices`, {
          method: 'POST',
          body: { ...v, amountInr: Number(v.amountInr) },
        }),
      );
      setInv(({ [c.id]: _, ...rest }) => rest);
      setMsg({ tone: 'success', text: `Invoice ${v.number} added.` });
    } catch (x) {
      fail(x);
    } finally {
      setBusy(null);
    }
  }
  async function mark(id: string, body: unknown) {
    setBusy(id);
    try {
      upsert(await apiFetch<ContractView>(`/v1/admin/invoices/${id}`, { method: 'POST', body }));
    } catch (x) {
      fail(x);
    } finally {
      setBusy(null);
    }
  }
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const shown = items.filter((c) => !filter || c.orgId === filter);

  return (
    <div className="space-y-8">
      <form onSubmit={submit} className="space-y-4 rounded-m border border-line bg-surface p-5">
        <h2 className="font-semibold">{editing ? 'Edit contract' : 'Add a contract'}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer" required>
            {(a) => (
              <Select {...a} value={f.orgId} onChange={set('orgId')} disabled={!!editing}>
                <option value="">Choose a customer</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Contract reference"
            required
            hint="The same reference as on the device coverage."
          >
            {(a) => <Input {...a} value={f.ref} onChange={set('ref')} maxLength={60} />}
          </Field>
          <Field label="Title" required className="sm:col-span-2">
            {(a) => <Input {...a} value={f.title} onChange={set('title')} maxLength={140} />}
          </Field>
          <Field label="Value (₹)" required>
            {(a) => (
              <Input
                {...a}
                type="number"
                min={0}
                step="1"
                value={f.valueInr}
                onChange={set('valueInr')}
              />
            )}
          </Field>
          <Field label="Account owner">
            {(a) => (
              <Select {...a} value={f.ownerId} onChange={set('ownerId')}>
                <option value="">Nobody yet</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Starts on" required>
            {(a) => <Input {...a} type="date" value={f.startsOn} onChange={set('startsOn')} />}
          </Field>
          <Field label="Ends on" required>
            {(a) => <Input {...a} type="date" value={f.endsOn} onChange={set('endsOn')} />}
          </Field>
        </div>
        <div className="flex gap-2">
          <Button
            type="submit"
            busy={busy === 'save'}
            disabled={!f.orgId || !f.ref || !f.title || !f.valueInr || !f.startsOn || !f.endsOn}
          >
            {editing ? 'Save contract' : 'Add contract'}
          </Button>
          {editing && (
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setF(empty);
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </form>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Field label="Show contracts for">
        {(a) => (
          <Select
            {...a}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-sm"
          >
            <option value="">Every customer</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <ul className="space-y-4">
        {shown.map((c) => {
          const v = inv[c.id] ?? { number: '', issuedOn: today(), dueOn: '', amountInr: '' };
          return (
            <li key={c.id} className="rounded-m border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">
                    {c.orgName}: {c.title}
                  </h3>
                  <p className="text-sm text-muted">
                    {c.ref}, {c.startsOn} to {c.endsOn}, {c.devices.length} device
                    {c.devices.length === 1 ? '' : 's'}, owner {c.owner?.name ?? 'nobody yet'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{inr(c.valueInr)}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(c.id);
                      setF({
                        orgId: c.orgId,
                        ref: c.ref,
                        title: c.title,
                        valueInr: String(c.valueInr),
                        startsOn: c.startsOn,
                        endsOn: c.endsOn,
                        ownerId: c.owner?.id ?? '',
                      });
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    aria-label={`Edit contract ${c.ref}`}
                  >
                    Edit
                  </Button>
                </div>
              </div>
              {c.invoices.length > 0 && (
                <table className="mt-3 w-full text-left text-sm">
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
                        <td className="py-1 pr-3">{i.dueOn}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{inr(i.amountInr)}</td>
                        <td
                          className={cn(
                            'py-1',
                            i.status === 'overdue' && 'font-semibold text-danger',
                          )}
                        >
                          {i.status === 'paid'
                            ? `Paid ${i.paidOn}`
                            : i.status === 'cancelled'
                              ? 'Cancelled'
                              : i.status === 'overdue'
                                ? 'Overdue'
                                : 'Due'}
                          {(i.status === 'issued' || i.status === 'overdue') && (
                            <span className="ml-2 inline-flex gap-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                busy={busy === i.id}
                                onClick={() => mark(i.id, { status: 'paid', paidOn: today() })}
                                aria-label={`Mark ${i.number} paid today`}
                              >
                                Paid today
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => mark(i.id, { status: 'cancelled' })}
                                aria-label={`Cancel ${i.number}`}
                              >
                                Cancel
                              </Button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-teal-ink">Add an invoice</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  {(
                    [
                      ['number', 'Invoice number', 'text'],
                      ['issuedOn', 'Issued on', 'date'],
                      ['dueOn', 'Due on', 'date'],
                      ['amountInr', 'Amount (₹)', 'number'],
                    ] as const
                  ).map(([k, label, type]) => (
                    <Field key={k} label={label}>
                      {(a) => (
                        <Input
                          {...a}
                          type={type}
                          value={v[k]}
                          onChange={(e) =>
                            setInv({ ...inv, [c.id]: { ...v, [k]: e.target.value } })
                          }
                        />
                      )}
                    </Field>
                  ))}
                </div>
                <Button
                  className="mt-3"
                  size="sm"
                  busy={busy === `inv-${c.id}`}
                  disabled={!v.number || !v.issuedOn || !v.dueOn || !v.amountInr}
                  onClick={() => addInvoice(c)}
                >
                  Add invoice
                </Button>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
