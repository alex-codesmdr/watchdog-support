'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  STATUS_LABELS,
  type CaseStatus,
  type CaseSuggestions,
  type CustomerContext,
  type JiraLink,
  type Presence,
  type TimeLog,
} from '@wd/contracts';
import { Button, Field, Input, Notice, fmtIst } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const hm = (m: number) =>
  m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;

/** Warns when another engineer has the same case open, and whether they are writing a reply. */
export function PresenceNotice({ number, replying }: { number: string; replying: boolean }) {
  const [others, setOthers] = useState<Presence['others']>([]);
  const replyingRef = useRef(replying);
  replyingRef.current = replying;
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await apiFetch<Presence>(`/v1/workspace/cases/${number}/presence`, {
          method: 'POST',
          body: { replying: replyingRef.current },
        });
        if (!stop) setOthers(r.others);
      } catch {
        /* presence is best effort */
      }
    };
    void tick();
    const id = setInterval(tick, 15_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [number]);
  if (!others.length) return null;
  const writing = others.filter((o) => o.replying);
  const names = (xs: { name: string }[]) => xs.map((x) => x.name).join(' and ');
  return (
    <Notice tone={writing.length ? 'warning' : 'info'} className="mb-4">
      {writing.length
        ? `${names(writing)} ${writing.length > 1 ? 'are' : 'is'} writing a reply on this case. Check before you send yours.`
        : `${names(others)} also ${others.length > 1 ? 'have' : 'has'} this case open.`}
    </Notice>
  );
}

/** The customer at a glance. */
export function CustomerPanel({ number }: { number: string }) {
  const q = useQuery({
    queryKey: ['case-context', number],
    queryFn: () => apiFetch<CustomerContext>(`/v1/workspace/cases/${number}/context`),
    staleTime: 60_000,
  });
  const c = q.data;
  return (
    <section aria-labelledby="cust" className="rounded-m border border-line bg-surface p-4">
      <h2 id="cust" className="font-semibold">
        Customer
      </h2>
      {!c ? (
        <p className="mt-2 text-sm text-muted">{q.isError ? 'Could not load.' : 'Loading…'}</p>
      ) : (
        <>
          <p className="text-sm text-muted">{c.orgName}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Open cases</dt>
            <dd className="text-right tabular-nums">{c.openCases}</dd>
            <dt className="text-muted">Cases, last 90 days</dt>
            <dd className="text-right tabular-nums">{c.casesLast90Days}</dd>
            <dt className="text-muted">Devices</dt>
            <dd className="text-right tabular-nums">{c.devices}</dd>
            <dt className="text-muted">Coverage ending in 60 days</dt>
            <dd className="text-right tabular-nums">{c.coverageEndingSoon}</dd>
            <dt className="text-muted">Satisfaction</dt>
            <dd className="text-right tabular-nums">
              {c.csatAverage === null ? 'No ratings' : `${c.csatAverage} of 5 (${c.csatResponses})`}
            </dd>
          </dl>
          {c.recentCases.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-semibold">Recent cases</h3>
              <ul className="mt-1 space-y-2 text-sm">
                {c.recentCases.map((r) => (
                  <li key={r.number}>
                    <Link
                      href={`/workspace/cases/${r.number}`}
                      className="text-teal-ink underline underline-offset-2"
                    >
                      {r.number}
                    </Link>{' '}
                    <span className="text-muted">
                      {r.severity}, {STATUS_LABELS[r.status as CaseStatus] ?? r.status}
                    </span>
                    <span className="block truncate">{r.subject}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Time logged on the case by engineers. Never shown to customers. */
export function TimePanel({ number, canLog }: { number: string; canLog: boolean }) {
  const qc = useQueryClient();
  const key = ['case-time', number];
  const q = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<TimeLog>(`/v1/workspace/cases/${number}/time`),
  });
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function log(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<TimeLog>(`/v1/workspace/cases/${number}/time`, {
        method: 'POST',
        body: { minutes: Number(minutes), note },
      });
      qc.setQueryData(key, r);
      setMinutes('');
      setNote('');
    } catch (x) {
      setErr(x instanceof ClientApiError ? (x.detail ?? x.title) : 'Could not log time');
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    try {
      qc.setQueryData(
        key,
        await apiFetch<TimeLog>(`/v1/workspace/time/${id}`, { method: 'DELETE' }),
      );
    } catch {
      setErr('Could not delete that entry');
    }
  }

  const t = q.data;
  return (
    <section aria-labelledby="time" className="rounded-m border border-line bg-surface p-4">
      <h2 id="time" className="font-semibold">
        Time logged
      </h2>
      <p className="text-sm text-muted">
        {t
          ? t.totalMinutes
            ? `${hm(t.totalMinutes)} in total`
            : 'Nothing logged yet'
          : 'Loading…'}
        . Only staff see this.
      </p>
      {t && t.entries.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm">
          {t.entries.slice(0, 8).map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="tabular-nums">{hm(e.minutes)}</span>, {e.by},{' '}
                {fmtIst(e.workedOn).split(',')[0]}
                {e.note && <span className="block text-muted">{e.note}</span>}
              </span>
              {e.mine && (
                <button
                  type="button"
                  onClick={() => remove(e.id)}
                  className="text-muted underline underline-offset-2 hover:text-ink"
                  aria-label={`Delete ${hm(e.minutes)} logged on ${e.workedOn}`}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canLog && (
        <form onSubmit={log} className="mt-4 flex flex-col gap-3">
          {err && <Notice tone="error">{err}</Notice>}
          <Field label="Minutes worked">
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))}
              />
            )}
          </Field>
          <Field label="What you did" hint="Optional">
            {(p) => (
              <Input
                {...p}
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          <div>
            <Button type="submit" size="sm" busy={busy} disabled={!Number(minutes)}>
              Log time
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

/** The engineering issue for this case, if any; L3 engineers and managers can raise one. */
export function JiraPanel({ number, canRaise }: { number: string; canRaise: boolean }) {
  const qc = useQueryClient();
  const key = ['case-jira', number];
  const q = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<{ link: JiraLink | null }>(`/v1/workspace/cases/${number}/jira`),
  });
  const [mode, setMode] = useState<'idle' | 'new' | 'existing'>('idle');
  const [notes, setNotes] = useState('');
  const [existing, setExisting] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(path: string, body?: unknown) {
    setBusy(true);
    setErr(null);
    try {
      qc.setQueryData(
        key,
        await apiFetch<{ link: JiraLink | null }>(`/v1/workspace/cases/${number}/jira${path}`, {
          method: 'POST',
          body,
        }),
      );
      setMode('idle');
    } catch (x) {
      setErr(x instanceof ClientApiError ? (x.detail ?? x.title) : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  const link = q.data?.link;
  if (!link && !canRaise) return null;
  return (
    <section aria-labelledby="eng" className="rounded-m border border-line bg-surface p-4">
      <h2 id="eng" className="font-semibold">
        Engineering issue
      </h2>
      {err && (
        <Notice tone="error" className="mt-2">
          {err}
        </Notice>
      )}
      {link ? (
        <div className="mt-2 space-y-2 text-sm">
          <p>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-teal-ink underline underline-offset-2"
            >
              {link.key}
            </a>{' '}
            in {link.tracker}
          </p>
          <p>
            Status: <span className="font-medium">{link.status}</span>
            {link.category === 'done' && ' (engineering has finished)'}
          </p>
          <p className="text-muted">Checked {fmtIst(link.syncedAt)}. Customers do not see this.</p>
          <Button size="sm" variant="secondary" busy={busy} onClick={() => run('/refresh')}>
            Check status now
          </Button>
        </div>
      ) : mode === 'idle' ? (
        <div className="mt-2 flex flex-col gap-2 text-sm">
          <p className="text-muted">For product defects that need a fix from engineering.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setMode('new')}>
              Raise an issue
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setMode('existing')}>
              Link an existing issue
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run('', mode === 'existing' ? { existingKey: existing } : { notes });
          }}
        >
          {mode === 'new' ? (
            <Field
              label="Notes for engineering"
              hint="The case details, device and customer description are included automatically."
            >
              {(p) => (
                <textarea
                  {...p}
                  rows={4}
                  value={notes}
                  maxLength={5000}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-s border border-line bg-surface p-2"
                />
              )}
            </Field>
          ) : (
            <Field label="Issue key" hint="For example WDENG-123">
              {(p) => (
                <Input {...p} value={existing} onChange={(e) => setExisting(e.target.value)} />
              )}
            </Field>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              busy={busy}
              disabled={mode === 'existing' && !existing.trim()}
            >
              {mode === 'new' ? 'Raise issue' : 'Link issue'}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Articles and solved cases that look like this one, to answer faster. */
export function SuggestionsPanel({ number }: { number: string }) {
  const q = useQuery({
    queryKey: ['case-suggestions', number],
    queryFn: () => apiFetch<CaseSuggestions>(`/v1/workspace/cases/${number}/suggestions`),
    staleTime: 5 * 60_000,
  });
  const s = q.data;
  return (
    <section aria-labelledby="sugg" className="rounded-m border border-line bg-surface p-4">
      <h2 id="sugg" className="font-semibold">
        Might help
      </h2>
      {!s ? (
        <p className="mt-2 text-sm text-muted">{q.isError ? 'Could not load.' : 'Loading…'}</p>
      ) : s.articles.length === 0 && s.cases.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No similar articles or solved cases found.</p>
      ) : (
        <>
          {s.articles.length > 0 && (
            <>
              <h3 className="mt-3 text-sm font-semibold">Articles</h3>
              <ul className="mt-1 space-y-1.5 text-sm">
                {s.articles.map((a) => (
                  <li key={a.slug}>
                    <a
                      href={`/kb/${a.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-teal-ink underline underline-offset-2"
                    >
                      {a.title}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {s.cases.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-semibold">Solved cases like this</h3>
              <ul className="mt-1 space-y-3 text-sm">
                {s.cases.map((c) => (
                  <li key={c.number}>
                    <Link
                      href={`/workspace/cases/${c.number}`}
                      className="text-teal-ink underline underline-offset-2"
                    >
                      {c.number}
                    </Link>{' '}
                    <span className="text-muted">{c.orgName}</span>
                    <span className="block">{c.subject}</span>
                    {c.resolution && (
                      <span className="mt-0.5 block text-muted">Last reply: {c.resolution}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
