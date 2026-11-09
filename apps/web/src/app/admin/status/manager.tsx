'use client';
import { useState } from 'react';
import {
  COMPONENT_STATUS_LABELS,
  INCIDENT_STATUS_LABELS,
  type ComponentStatus,
  type IncidentStatus,
  type StatusPage,
} from '@wd/contracts';
import { Button, Field, Input, Notice, Select, Textarea } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const COMPONENT = Object.keys(COMPONENT_STATUS_LABELS) as ComponentStatus[];
const OUTAGE_STEPS: IncidentStatus[] = ['investigating', 'identified', 'monitoring', 'resolved'];
const MAINT_STEPS: IncidentStatus[] = ['scheduled', 'in_progress', 'completed'];

export function StatusManager({ initial }: { initial: StatusPage }) {
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [f, setF] = useState({
    title: '',
    impact: 'minor' as 'minor' | 'major' | 'critical' | 'maintenance',
    componentIds: [] as string[],
    componentStatus: 'degraded' as ComponentStatus,
    body: '',
  });
  const [upd, setUpd] = useState<Record<string, { status: IncidentStatus; body: string }>>({});

  async function call(key: string, path: string, body: unknown, done: string) {
    setBusy(key);
    setMsg(null);
    try {
      setS(await apiFetch<StatusPage>(path, { method: 'POST', body }));
      setMsg({ tone: 'success', text: done });
      return true;
    } catch (x) {
      setMsg({
        tone: 'error',
        text: x instanceof ClientApiError ? (x.detail ?? x.title) : 'That did not work',
      });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const maint = f.impact === 'maintenance';
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
      <div className="min-w-0 space-y-8">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <section aria-labelledby="open-inc" className="space-y-4">
          <h2 id="open-inc" className="font-semibold">
            Open incidents
          </h2>
          {s.active.length === 0 && <p className="text-muted">None. Every incident is closed.</p>}
          {s.active.map((i) => {
            const steps = i.impact === 'maintenance' ? MAINT_STEPS : OUTAGE_STEPS;
            const u = upd[i.id] ?? {
              status: steps[Math.min(steps.indexOf(i.status) + 1, steps.length - 1)]!,
              body: '',
            };
            return (
              <form
                key={i.id}
                className="space-y-3 rounded-m border border-line bg-surface p-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await call(
                      i.id,
                      `/v1/admin/status/incidents/${i.id}/updates`,
                      u,
                      `Update posted: ${i.title}`,
                    )
                  )
                    setUpd((x) => ({ ...x, [i.id]: { ...u, body: '' } }));
                }}
              >
                <p className="font-medium">{i.title}</p>
                <p className="text-sm text-muted">Now: {INCIDENT_STATUS_LABELS[i.status]}</p>
                <Field label="New status">
                  {(p) => (
                    <Select
                      {...p}
                      value={u.status}
                      onChange={(e) =>
                        setUpd((x) => ({
                          ...x,
                          [i.id]: { ...u, status: e.target.value as IncidentStatus },
                        }))
                      }
                    >
                      {steps.map((st) => (
                        <option key={st} value={st}>
                          {INCIDENT_STATUS_LABELS[st]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field
                  label="Update for customers"
                  hint="What is happening and when you will update next."
                >
                  {(p) => (
                    <Textarea
                      {...p}
                      rows={3}
                      value={u.body}
                      onChange={(e) =>
                        setUpd((x) => ({ ...x, [i.id]: { ...u, body: e.target.value } }))
                      }
                    />
                  )}
                </Field>
                <Button
                  type="submit"
                  size="sm"
                  busy={busy === i.id}
                  disabled={u.body.trim().length < 5}
                >
                  Post update
                </Button>
              </form>
            );
          })}
        </section>
        <section aria-labelledby="svc">
          <h2 id="svc" className="font-semibold">
            Services
          </h2>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {s.components.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <label htmlFor={`c-${c.id}`} className="font-medium">
                  {c.name}
                </label>
                <select
                  id={`c-${c.id}`}
                  value={c.status}
                  disabled={busy === c.id}
                  onChange={(e) =>
                    call(
                      c.id,
                      `/v1/admin/status/components/${c.id}`,
                      { status: e.target.value },
                      `${c.name}: ${COMPONENT_STATUS_LABELS[e.target.value as ComponentStatus]}`,
                    )
                  }
                  className="h-9 rounded-s border border-line bg-surface px-2 text-sm"
                >
                  {COMPONENT.map((st) => (
                    <option key={st} value={st}>
                      {COMPONENT_STATUS_LABELS[st]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <form
        className="flex flex-col gap-4 self-start rounded-m border border-line bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await call(
            'new',
            '/v1/admin/status/incidents',
            {
              ...f,
              status: maint ? 'in_progress' : 'investigating',
              componentStatus: maint ? 'maintenance' : f.componentStatus,
            },
            `Incident opened: ${f.title}`,
          );
          if (ok)
            setF({
              title: '',
              impact: 'minor',
              componentIds: [],
              componentStatus: 'degraded',
              body: '',
            });
        }}
      >
        <h2 className="font-semibold">Open an incident</h2>
        <Field label="Title" required hint="For example: Case emails delayed">
          {(p) => (
            <Input
              {...p}
              value={f.title}
              maxLength={140}
              onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))}
            />
          )}
        </Field>
        <Field label="Kind">
          {(p) => (
            <Select
              {...p}
              value={f.impact}
              onChange={(e) => setF((x) => ({ ...x, impact: e.target.value as typeof f.impact }))}
            >
              <option value="minor">Minor problem</option>
              <option value="major">Major problem</option>
              <option value="critical">Critical outage</option>
              <option value="maintenance">Planned maintenance</option>
            </Select>
          )}
        </Field>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Services affected</legend>
          {s.components.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.componentIds.includes(c.id)}
                onChange={() =>
                  setF((x) => ({
                    ...x,
                    componentIds: x.componentIds.includes(c.id)
                      ? x.componentIds.filter((y) => y !== c.id)
                      : [...x.componentIds, c.id],
                  }))
                }
              />
              {c.name}
            </label>
          ))}
        </fieldset>
        {!maint && (
          <Field label="Show those services as">
            {(p) => (
              <Select
                {...p}
                value={f.componentStatus}
                onChange={(e) =>
                  setF((x) => ({ ...x, componentStatus: e.target.value as ComponentStatus }))
                }
              >
                {(['degraded', 'partial_outage', 'major_outage'] as ComponentStatus[]).map((st) => (
                  <option key={st} value={st}>
                    {COMPONENT_STATUS_LABELS[st]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="First update for customers" required>
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              value={f.body}
              onChange={(e) => setF((x) => ({ ...x, body: e.target.value }))}
            />
          )}
        </Field>
        <Button
          type="submit"
          busy={busy === 'new'}
          disabled={f.title.trim().length < 5 || !f.componentIds.length || f.body.trim().length < 5}
        >
          Open incident
        </Button>
      </form>
    </div>
  );
}
