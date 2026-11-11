'use client';
import { useState } from 'react';
import type { StockView } from '@wd/contracts';
import { Button, Field, Input, Notice, Select, Textarea, cn } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

export function StockManager({ initial, canManage }: { initial: StockView; canManage: boolean }) {
  const [s, setS] = useState(initial);
  const [add, setAdd] = useState({ depotId: '', sku: '', serials: '' });
  const [lvl, setLvl] = useState({ depotId: '', sku: '', min: '' });
  const [dep, setDep] = useState({ name: '', city: '', state: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function call(key: string, path: string, method: string, body: unknown, done: string) {
    setBusy(key);
    setMsg(null);
    try {
      setS(await apiFetch<StockView>(path, { method, body }));
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
  const serials = add.serials
    .split(/[\s,;]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

  return (
    <div className="space-y-8">
      {s.belowMinimum > 0 && (
        <Notice tone="warning">
          {s.belowMinimum} model{s.belowMinimum === 1 ? ' is' : 's are'} below the minimum at a
          depot.
        </Notice>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Spare units by model and depot (on hand, with the minimum)
          </caption>
          <thead className="text-muted">
            <tr>
              <th className="py-2 pr-4 font-medium">Model</th>
              {s.depots.map((d) => (
                <th key={d.id} className="py-2 pr-4 text-right font-medium">
                  {d.name}
                </th>
              ))}
              <th className="py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {s.products.map((p) => (
              <tr key={p.id} className="border-t border-line align-top">
                <td className="py-2 pr-4">
                  {p.modelName}
                  <span className="block text-xs text-muted">{p.sku}</span>
                </td>
                {p.byDepot.map((d) => (
                  <td key={d.depotId} className="py-2 pr-4 text-right tabular-nums">
                    <span className={cn(d.onHand < d.min && 'font-semibold text-danger')}>
                      {d.onHand}
                    </span>
                    {d.min > 0 && <span className="text-muted"> / min {d.min}</span>}
                    {d.serials.length > 0 && (
                      <details className="text-left">
                        <summary className="cursor-pointer text-xs text-teal-ink">Serials</summary>
                        <ul className="mt-1 space-y-1">
                          {d.serials.map((x) => (
                            <li key={x} className="font-mono text-xs">
                              {x}
                              {canManage && (
                                <span className="ml-2 font-sans">
                                  <select
                                    aria-label={`Move ${x} to another depot`}
                                    className="rounded-s border border-line bg-surface text-xs"
                                    value=""
                                    onChange={(e) =>
                                      e.target.value &&
                                      call(
                                        x,
                                        `/v1/workspace/stock/spares/${x}/move`,
                                        'POST',
                                        { depotId: e.target.value },
                                        `Moved ${x}.`,
                                      )
                                    }
                                  >
                                    <option value="">Move to…</option>
                                    {s.depots
                                      .filter((o) => o.id !== d.depotId)
                                      .map((o) => (
                                        <option key={o.id} value={o.id}>
                                          {o.name}
                                        </option>
                                      ))}
                                  </select>
                                  <button
                                    type="button"
                                    className="ml-2 text-xs text-teal-ink underline"
                                    onClick={() => {
                                      const reason = window.prompt(
                                        `Why is ${x} being written off?`,
                                      );
                                      if (reason && reason.trim().length >= 3)
                                        void call(
                                          x,
                                          `/v1/workspace/stock/spares/${x}/write-off`,
                                          'POST',
                                          { reason: reason.trim() },
                                          `Wrote off ${x}.`,
                                        );
                                    }}
                                  >
                                    Write off
                                  </button>
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                ))}
                <td className="py-2 text-right font-semibold tabular-nums">{p.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage && (
        <div className="grid gap-6 lg:grid-cols-2">
          <form
            className="space-y-3 rounded-m border border-line bg-surface p-5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await call(
                  'add',
                  '/v1/workspace/stock/spares',
                  'POST',
                  { depotId: add.depotId, sku: add.sku, serials },
                  `Added ${serials.length} spare${serials.length === 1 ? '' : 's'}.`,
                )
              )
                setAdd({ ...add, serials: '' });
            }}
          >
            <h2 className="font-semibold">Add spares</h2>
            <DepotModel s={s} v={add} set={(v) => setAdd({ ...add, ...v })} />
            <Field label="Serial numbers" hint="One per line, or separated by commas.">
              {(a) => (
                <Textarea
                  {...a}
                  rows={3}
                  className="font-mono uppercase"
                  value={add.serials}
                  onChange={(e) => setAdd({ ...add, serials: e.target.value })}
                />
              )}
            </Field>
            <Button
              type="submit"
              busy={busy === 'add'}
              disabled={!add.depotId || !add.sku || !serials.length}
            >
              Add {serials.length || ''} spare{serials.length === 1 ? '' : 's'}
            </Button>
          </form>
          <div className="space-y-6">
            <form
              className="space-y-3 rounded-m border border-line bg-surface p-5"
              onSubmit={(e) => {
                e.preventDefault();
                void call(
                  'lvl',
                  '/v1/workspace/stock/levels',
                  'PUT',
                  { ...lvl, min: Number(lvl.min) },
                  'Minimum saved.',
                );
              }}
            >
              <h2 className="font-semibold">Minimum to keep</h2>
              <DepotModel s={s} v={lvl} set={(v) => setLvl({ ...lvl, ...v })} />
              <Field label="Minimum units">
                {(a) => (
                  <Input
                    {...a}
                    type="number"
                    min={0}
                    max={1000}
                    value={lvl.min}
                    onChange={(e) => setLvl({ ...lvl, min: e.target.value })}
                  />
                )}
              </Field>
              <Button
                type="submit"
                busy={busy === 'lvl'}
                disabled={!lvl.depotId || !lvl.sku || lvl.min === ''}
              >
                Save minimum
              </Button>
            </form>
            <form
              className="space-y-3 rounded-m border border-line bg-surface p-5"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await call(
                    'dep',
                    '/v1/workspace/stock/depots',
                    'POST',
                    dep,
                    `Added depot ${dep.name}.`,
                  )
                )
                  setDep({ name: '', city: '', state: '' });
              }}
            >
              <h2 className="font-semibold">Add a depot</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {(['name', 'city', 'state'] as const).map((k) => (
                  <Field key={k} label={k === 'name' ? 'Name' : k === 'city' ? 'City' : 'State'}>
                    {(a) => (
                      <Input
                        {...a}
                        value={dep[k]}
                        onChange={(e) => setDep({ ...dep, [k]: e.target.value })}
                      />
                    )}
                  </Field>
                ))}
              </div>
              <Button
                type="submit"
                busy={busy === 'dep'}
                disabled={!dep.name || !dep.city || !dep.state}
              >
                Add depot
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function DepotModel({
  s,
  v,
  set,
}: {
  s: StockView;
  v: { depotId: string; sku: string };
  set: (v: Partial<{ depotId: string; sku: string }>) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Depot">
        {(a) => (
          <Select {...a} value={v.depotId} onChange={(e) => set({ depotId: e.target.value })}>
            <option value="">Choose</option>
            {s.depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Model">
        {(a) => (
          <Select {...a} value={v.sku} onChange={(e) => set({ sku: e.target.value })}>
            <option value="">Choose</option>
            {s.products.map((p) => (
              <option key={p.sku} value={p.sku}>
                {p.modelName}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}
