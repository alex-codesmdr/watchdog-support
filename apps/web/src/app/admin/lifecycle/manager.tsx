'use client';
import { useState } from 'react';
import { LIFECYCLE_LABELS, type ProductLifecycleView } from '@wd/contracts';
import { Button, Field, Input, Notice, Select, Textarea } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

type Form = {
  lifecycle: ProductLifecycleView['lifecycle'];
  endOfSale: string;
  endOfSupport: string;
  replacementSku: string;
  advice: string;
  notify: boolean;
};

export function LifecycleManager({ initial }: { initial: ProductLifecycleView[] }) {
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  function start(p: ProductLifecycleView) {
    setOpen(p.id);
    setF({
      lifecycle: p.lifecycle,
      endOfSale: p.endOfSale ?? '',
      endOfSupport: p.endOfSupport ?? '',
      replacementSku: p.replacementSku ?? '',
      advice: p.advice ?? '',
      notify: false,
    });
    setMsg(null);
  }
  async function save(p: ProductLifecycleView) {
    if (!f) return;
    setBusy(true);
    try {
      const v = await apiFetch<ProductLifecycleView>(`/v1/admin/products/${p.id}/lifecycle`, {
        method: 'PUT',
        body: {
          lifecycle: f.lifecycle,
          endOfSale: f.endOfSale || null,
          endOfSupport: f.endOfSupport || null,
          replacementSku: f.replacementSku || null,
          advice: f.advice.trim() || null,
          notify: f.notify,
        },
      });
      setItems((xs) => xs.map((x) => (x.id === v.id ? v : x)));
      setMsg({
        tone: 'success',
        text: `Saved ${v.modelName}.${f.notify && f.lifecycle !== 'ga' ? ` Emailing the administrators of ${v.customers} customer${v.customers === 1 ? '' : 's'}.` : ''}`,
      });
      setOpen(null);
    } catch (x) {
      setMsg({
        tone: 'error',
        text: x instanceof ClientApiError ? (x.detail ?? x.title) : 'Could not save.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <ul className="divide-y divide-line border-y border-line">
        {items.map((p) => (
          <li key={p.id} className="py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{p.modelName}</p>
                <p className="text-sm text-muted">
                  {p.sku}, {p.familyName}. {p.installed} installed at {p.customers} customer
                  {p.customers === 1 ? '' : 's'}.
                </p>
                <p className="text-sm">
                  {LIFECYCLE_LABELS[p.lifecycle]}
                  {p.endOfSale ? `. End of sale ${p.endOfSale}` : ''}
                  {p.endOfSupport ? `. End of support ${p.endOfSupport}` : ''}
                  {p.replacementSku ? `. Replacement ${p.replacementSku}` : ''}
                </p>
              </div>
              {open !== p.id && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => start(p)}
                  aria-label={`Change lifecycle of ${p.modelName}`}
                >
                  Change
                </Button>
              )}
            </div>
            {open === p.id && f && (
              <div className="mt-4 space-y-4 rounded-m border border-line bg-surface p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Stage">
                    {(a) => (
                      <Select
                        {...a}
                        value={f.lifecycle}
                        onChange={(e) =>
                          setF({ ...f, lifecycle: e.target.value as Form['lifecycle'] })
                        }
                      >
                        {Object.entries(LIFECYCLE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Suggested replacement">
                    {(a) => (
                      <Select
                        {...a}
                        value={f.replacementSku}
                        onChange={(e) => setF({ ...f, replacementSku: e.target.value })}
                      >
                        <option value="">None</option>
                        {items
                          .filter((x) => x.id !== p.id && x.lifecycle === 'ga')
                          .map((x) => (
                            <option key={x.sku} value={x.sku}>
                              {x.modelName}
                            </option>
                          ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="End of sale">
                    {(a) => (
                      <Input
                        {...a}
                        type="date"
                        value={f.endOfSale}
                        onChange={(e) => setF({ ...f, endOfSale: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="End of support">
                    {(a) => (
                      <Input
                        {...a}
                        type="date"
                        value={f.endOfSupport}
                        onChange={(e) => setF({ ...f, endOfSupport: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
                <Field label="Advice for customers">
                  {(a) => (
                    <Textarea
                      {...a}
                      rows={3}
                      maxLength={1000}
                      value={f.advice}
                      onChange={(e) => setF({ ...f, advice: e.target.value })}
                    />
                  )}
                </Field>
                {f.lifecycle !== 'ga' && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={f.notify}
                      onChange={(e) => setF({ ...f, notify: e.target.checked })}
                    />
                    Email the administrators of the {p.customers} customer
                    {p.customers === 1 ? '' : 's'} who own this model
                  </label>
                )}
                <div className="flex gap-2">
                  <Button busy={busy} onClick={() => save(p)}>
                    Save
                  </Button>
                  <Button variant="ghost" onClick={() => setOpen(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
