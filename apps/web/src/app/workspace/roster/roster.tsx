'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Engineer, Roster } from '@wd/contracts';
import { Button, Field, Input, Notice, Select } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const IST = 'Asia/Kolkata';
const dayKey = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date(iso));
const dayName = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }).format(
    new Date(`${d}T12:00:00+05:30`),
  );
const time = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export function RosterView({
  r,
  manage,
  engineers,
}: {
  r: Roster;
  manage: boolean;
  engineers: Engineer[];
}) {
  const router = useRouter();
  const [f, setF] = useState({
    userId: '',
    day: r.from,
    start: '09:00',
    end: '18:00',
    p1: false,
    repeat: '0',
    note: '',
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(r.from, i));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const startsAt = new Date(`${f.day}T${f.start}:00+05:30`);
    let endsAt = new Date(`${f.day}T${f.end}:00+05:30`);
    if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86400_000); // overnight
    setBusy('add');
    setMsg(null);
    try {
      const r2 = await apiFetch<{ added: number }>('/v1/admin/roster', {
        method: 'POST',
        body: {
          userId: f.userId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          p1: f.p1,
          repeatDays: Number(f.repeat),
          ...(f.note.trim() ? { note: f.note.trim() } : {}),
        },
      });
      setMsg({ tone: 'success', text: `Added ${r2.added} shift${r2.added === 1 ? '' : 's'}.` });
      router.refresh();
    } catch (x) {
      setMsg({
        tone: 'error',
        text: x instanceof ClientApiError ? (x.detail ?? x.title) : 'Could not add the shift.',
      });
    } finally {
      setBusy(null);
    }
  }
  async function remove(id: string) {
    setBusy(id);
    try {
      await apiFetch(`/v1/admin/roster/${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (x) {
      setMsg({
        tone: 'error',
        text: x instanceof ClientApiError ? (x.detail ?? x.title) : 'Could not remove the shift.',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="now" className="rounded-m border border-line bg-surface p-5">
        <h2 id="now" className="font-semibold">
          On shift now
        </h2>
        {r.onShiftNow.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Nobody is on shift right now.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {r.onShiftNow.map((n) => (
              <li key={`${n.name}-${n.until}`}>
                <span className="font-medium">{n.name}</span>
                {n.p1 && (
                  <span className="ml-2 rounded-s bg-danger px-1.5 py-0.5 text-xs font-semibold text-white">
                    P1 phone
                  </span>
                )}
                <span className="text-muted"> until {time(n.until)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <nav aria-label="Week" className="flex flex-wrap gap-x-5 text-sm">
        <Link
          className="text-teal-ink underline underline-offset-2"
          href={`/workspace/roster?from=${addDays(r.from, -7)}`}
        >
          Previous week
        </Link>
        <Link className="text-teal-ink underline underline-offset-2" href="/workspace/roster">
          This week
        </Link>
        <Link
          className="text-teal-ink underline underline-offset-2"
          href={`/workspace/roster?from=${addDays(r.from, 7)}`}
        >
          Next week
        </Link>
      </nav>

      <div className="space-y-5">
        {days.map((d) => {
          const shifts = r.shifts.filter((s) => dayKey(s.startsAt) === d);
          return (
            <section key={d} aria-labelledby={`d-${d}`}>
              <h2 id={`d-${d}`} className="text-sm font-semibold">
                {dayName(d)}
              </h2>
              {shifts.length === 0 ? (
                <p className="text-sm text-muted">No shifts.</p>
              ) : (
                <ul className="mt-1 divide-y divide-line border-y border-line">
                  {shifts.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                    >
                      <span>
                        <span className="tabular-nums">
                          {time(s.startsAt)} to {time(s.endsAt)}
                        </span>{' '}
                        <span className="font-medium">{s.name}</span>
                        {s.p1 && (
                          <span className="ml-2 rounded-s bg-danger px-1.5 py-0.5 text-xs font-semibold text-white">
                            P1 phone
                          </span>
                        )}
                        {s.note && <span className="text-muted">, {s.note}</span>}
                      </span>
                      {manage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          busy={busy === s.id}
                          onClick={() => remove(s.id)}
                          aria-label={`Remove ${s.name}'s shift at ${time(s.startsAt)} on ${dayName(d)}`}
                        >
                          Remove
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {manage && (
        <form onSubmit={add} className="space-y-4 rounded-m border border-line bg-surface p-5">
          <h2 className="font-semibold">Add a shift</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Engineer" required>
              {(a) => (
                <Select
                  {...a}
                  value={f.userId}
                  onChange={(e) => setF({ ...f, userId: e.target.value })}
                >
                  <option value="">Choose</option>
                  {engineers.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Day" required>
              {(a) => (
                <Input
                  {...a}
                  type="date"
                  value={f.day}
                  onChange={(e) => setF({ ...f, day: e.target.value })}
                />
              )}
            </Field>
            <Field label="Repeat on the next" hint="Days after the first one.">
              {(a) => (
                <Select
                  {...a}
                  value={f.repeat}
                  onChange={(e) => setF({ ...f, repeat: e.target.value })}
                >
                  {[0, 1, 2, 3, 4, 5, 6, 13].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? 'No repeat' : `${n} days`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="From" required>
              {(a) => (
                <Input
                  {...a}
                  type="time"
                  value={f.start}
                  onChange={(e) => setF({ ...f, start: e.target.value })}
                />
              )}
            </Field>
            <Field label="To" required hint="An earlier time means the next morning.">
              {(a) => (
                <Input
                  {...a}
                  type="time"
                  value={f.end}
                  onChange={(e) => setF({ ...f, end: e.target.value })}
                />
              )}
            </Field>
            <Field label="Note">
              {(a) => (
                <Input
                  {...a}
                  value={f.note}
                  maxLength={200}
                  onChange={(e) => setF({ ...f, note: e.target.value })}
                />
              )}
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.p1}
              onChange={(e) => setF({ ...f, p1: e.target.checked })}
            />
            Carries the P1 phone (gets unassigned P1 cases and alerts)
          </label>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <Button type="submit" busy={busy === 'add'} disabled={!f.userId}>
            Add shift
          </Button>
        </form>
      )}
    </div>
  );
}
