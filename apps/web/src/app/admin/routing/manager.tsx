'use client';
import { useState } from 'react';
import {
  type CaseCategory,
  SEVERITY_LABELS,
  type RoutingOptions,
  type RoutingRule,
  type Severity,
} from '@wd/contracts';
import { Button, EmptyState, Field, Input, Notice, Select } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const CATEGORY: Record<CaseCategory, string> = {
  hardware: 'Hardware',
  software: 'Software',
  config: 'Configuration',
  performance: 'Performance',
  security: 'Security',
  licensing: 'Licensing',
  documentation: 'Documentation',
};
const SEVERITIES: Severity[] = ['P1', 'P2', 'P3', 'P4'];

interface Form {
  id: string | null;
  name: string;
  enabled: boolean;
  severities: Severity[];
  categories: CaseCategory[];
  familyIds: string[];
  orgIds: string[];
  queueId: string;
  assigneeIds: string[];
}
const blank: Form = {
  id: null,
  name: '',
  enabled: true,
  severities: [],
  categories: [],
  familyIds: [],
  orgIds: [],
  queueId: '',
  assigneeIds: [],
};
const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

function Checks<T extends string>({
  legend,
  hint,
  items,
  value,
  onChange,
}: {
  legend: string;
  hint?: string;
  items: { id: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{legend}</legend>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
        {items.map((i) => (
          <label key={i.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.includes(i.id)}
              onChange={() => onChange(toggle(value, i.id))}
            />
            {i.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function RoutingManager({
  initial,
  options,
}: {
  initial: RoutingRule[];
  options: RoutingOptions;
}) {
  const [rules, setRules] = useState(initial);
  const [f, setF] = useState<Form>(blank);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const name = <T extends { id: string; name: string }>(xs: T[], id: string) =>
    xs.find((x) => x.id === id)?.name ?? 'Unknown';
  const fail = (err: unknown, fallback: string) =>
    setMsg({
      tone: 'error',
      text: err instanceof ClientApiError ? (err.detail ?? err.title) : fallback,
    });

  const summary = (r: RoutingRule) => {
    const when = [
      r.severities.length ? r.severities.join(' or ') : null,
      r.categories.length ? r.categories.map((c) => CATEGORY[c]).join(' or ') : null,
      r.familyIds.length ? r.familyIds.map((i) => name(options.families, i)).join(' or ') : null,
      r.orgIds.length ? r.orgIds.map((i) => name(options.organizations, i)).join(' or ') : null,
    ].filter(Boolean);
    const then = [
      r.queueId ? `queue ${name(options.queues, r.queueId)}` : null,
      r.assigneeIds.length
        ? `assign to ${r.assigneeIds.map((i) => name(options.engineers, i)).join(', ')}`
        : null,
    ].filter(Boolean);
    return `${when.length ? `When ${when.join('; ')}` : 'Every case'}: ${then.join(', and ')}.`;
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    setMsg(null);
    try {
      const body = { ...f, queueId: f.queueId || null };
      const r = await apiFetch<RoutingRule>(
        f.id ? `/v1/admin/routing/rules/${f.id}` : '/v1/admin/routing/rules',
        {
          method: f.id ? 'PUT' : 'POST',
          body,
        },
      );
      setRules((xs) => (f.id ? xs.map((x) => (x.id === r.id ? r : x)) : [...xs, r]));
      setMsg({ tone: 'success', text: `Saved: ${r.name}` });
      setF(blank);
    } catch (err) {
      fail(err, 'Could not save the rule');
    } finally {
      setBusy(null);
    }
  }

  async function move(i: number, d: -1 | 1) {
    const next = [...rules];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    setBusy(`move-${i}`);
    try {
      const r = await apiFetch<{ items: RoutingRule[] }>('/v1/admin/routing/order', {
        method: 'PUT',
        body: { ids: next.map((x) => x.id) },
      });
      setRules(r.items);
    } catch (err) {
      fail(err, 'Could not change the order');
    } finally {
      setBusy(null);
    }
  }

  async function remove(r: RoutingRule) {
    setBusy(r.id);
    try {
      await apiFetch(`/v1/admin/routing/rules/${r.id}`, { method: 'DELETE' });
      setRules((xs) => xs.filter((x) => x.id !== r.id));
      setMsg({ tone: 'success', text: `Deleted: ${r.name}` });
      if (f.id === r.id) setF(blank);
    } catch (err) {
      fail(err, 'Could not delete the rule');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_26rem]">
      <section aria-labelledby="rules" className="min-w-0">
        <h2 id="rules" className="sr-only">
          Rules in order
        </h2>
        {msg && (
          <div className="mb-4">
            <Notice tone={msg.tone}>{msg.text}</Notice>
          </div>
        )}
        {rules.length === 0 ? (
          <EmptyState title="No rules yet">
            Every new case waits in the Unassigned queue until an engineer picks it up. Add a rule
            to send cases straight to the right people.
          </EmptyState>
        ) : (
          <ol className="divide-y divide-line border-y border-line">
            {rules.map((r, i) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {i + 1}. {r.name}
                    {!r.enabled && <span className="font-normal text-muted"> (switched off)</span>}
                  </p>
                  <p className="text-sm text-muted">{summary(r)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={i === 0}
                    busy={busy === `move-${i - 1}`}
                    onClick={() => move(i, -1)}
                    aria-label={`Move up: ${r.name}`}
                  >
                    Up
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={i === rules.length - 1}
                    busy={busy === `move-${i}`}
                    onClick={() => move(i, 1)}
                    aria-label={`Move down: ${r.name}`}
                  >
                    Down
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setF({
                        id: r.id,
                        name: r.name,
                        enabled: r.enabled,
                        severities: r.severities,
                        categories: r.categories,
                        familyIds: r.familyIds,
                        orgIds: r.orgIds,
                        queueId: r.queueId ?? '',
                        assigneeIds: r.assigneeIds,
                      })
                    }
                    aria-label={`Edit: ${r.name}`}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    busy={busy === r.id}
                    onClick={() => remove(r)}
                    aria-label={`Delete: ${r.name}`}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <form
        onSubmit={save}
        className="flex flex-col gap-5 self-start rounded-m border border-line bg-surface p-4"
      >
        <h2 className="font-semibold">{f.id ? 'Edit rule' : 'New rule'}</h2>
        <Field label="Rule name" required hint="For example: Critical switching cases">
          {(p) => (
            <Input
              {...p}
              value={f.name}
              maxLength={120}
              onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))}
            />
          )}
        </Field>
        <p className="text-sm text-muted">Leave a condition empty to match any value.</p>
        <Checks
          legend="Severity"
          items={SEVERITIES.map((s) => ({ id: s, label: SEVERITY_LABELS[s] }))}
          value={f.severities}
          onChange={(v) => setF((x) => ({ ...x, severities: v }))}
        />
        <Checks
          legend="Product family"
          items={options.families.map((x) => ({ id: x.id, label: x.name }))}
          value={f.familyIds}
          onChange={(v) => setF((x) => ({ ...x, familyIds: v }))}
        />
        <Checks
          legend="Problem type"
          items={(Object.keys(CATEGORY) as CaseCategory[]).map((c) => ({
            id: c,
            label: CATEGORY[c],
          }))}
          value={f.categories}
          onChange={(v) => setF((x) => ({ ...x, categories: v }))}
        />
        <Field
          label="Customers"
          hint="Hold Ctrl (Cmd on a Mac) to choose more than one. None chosen means every customer."
        >
          {(p) => (
            <select
              {...p}
              multiple
              size={Math.min(6, Math.max(3, options.organizations.length))}
              value={f.orgIds}
              onChange={(e) =>
                setF((x) => ({ ...x, orgIds: [...e.target.selectedOptions].map((o) => o.value) }))
              }
              className="w-full rounded-s border border-line bg-surface p-1 text-sm"
            >
              {options.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Put in queue">
          {(p) => (
            <Select
              {...p}
              value={f.queueId}
              onChange={(e) => setF((x) => ({ ...x, queueId: e.target.value }))}
            >
              <option value="">Keep the default queue</option>
              {options.queues.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Checks
          legend="Assign to the least busy of"
          hint="Numbers show each engineer's open cases now."
          items={options.engineers.map((x) => ({ id: x.id, label: `${x.name} (${x.openCases})` }))}
          value={f.assigneeIds}
          onChange={(v) => setF((x) => ({ ...x, assigneeIds: v }))}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.enabled}
            onChange={(e) => setF((x) => ({ ...x, enabled: e.target.checked }))}
          />
          Rule is switched on
        </label>
        <div className="flex gap-2">
          <Button
            type="submit"
            busy={busy === 'save'}
            disabled={f.name.trim().length < 3 || (!f.queueId && !f.assigneeIds.length)}
          >
            {f.id ? 'Save changes' : 'Add rule'}
          </Button>
          {f.id && (
            <Button type="button" variant="secondary" onClick={() => setF(blank)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
