'use client';
import { useState } from 'react';
import { IDEA_STATUSES, IDEA_STATUS_LABELS, type IdeaStatus, type IdeaView } from '@wd/contracts';
import { Button, EmptyState, Field, Input, Notice, Select, Textarea, cn } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );
const errText = (x: unknown, fallback: string) =>
  x instanceof ClientApiError ? (x.detail ?? x.title) : fallback;

/**
 * The suggestion board. Customers post and vote; staff (canManage) also set a status, reply and
 * hide. Nobody but staff sees who posted a suggestion.
 */
export function IdeaBoard({
  initial,
  canPost,
  canManage,
  families,
}: {
  initial: IdeaView[];
  canPost: boolean;
  canManage: boolean;
  families: { key: string; name: string }[];
}) {
  const [items, setItems] = useState(initial);
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const [status, setStatus] = useState<'' | IdeaStatus>('');
  const [f, setF] = useState({ title: '', body: '', familyKey: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [edit, setEdit] = useState<Record<string, { status: IdeaStatus; response: string }>>({});

  async function reload(s = sort, st = status) {
    const qs = new URLSearchParams({ sort: s, ...(st ? { status: st } : {}) });
    setItems((await apiFetch<{ items: IdeaView[] }>(`/v1/ideas?${qs}`)).items);
  }
  const replace = (v: IdeaView) => setItems((xs) => xs.map((x) => (x.id === v.id ? v : x)));

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setBusy('post');
    setMsg(null);
    try {
      const v = await apiFetch<IdeaView>('/v1/ideas', {
        method: 'POST',
        body: {
          title: f.title.trim(),
          body: f.body.trim(),
          ...(f.familyKey ? { familyKey: f.familyKey } : {}),
        },
      });
      setItems((xs) => [v, ...xs]);
      setF({ title: '', body: '', familyKey: '' });
      setMsg({ tone: 'success', text: 'Thanks. Your suggestion is on the board.' });
    } catch (x) {
      setMsg({ tone: 'error', text: errText(x, 'Could not post your suggestion.') });
    } finally {
      setBusy(null);
    }
  }

  async function vote(i: IdeaView) {
    setBusy(i.id);
    try {
      replace(
        await apiFetch<IdeaView>(`/v1/ideas/${i.id}/vote`, {
          method: i.votedByMe ? 'DELETE' : 'POST',
          body: {},
        }),
      );
    } catch (x) {
      setMsg({ tone: 'error', text: errText(x, 'Could not record your vote.') });
    } finally {
      setBusy(null);
    }
  }

  async function save(i: IdeaView, hidden?: boolean) {
    const e = edit[i.id] ?? { status: i.status, response: i.response ?? '' };
    setBusy(`save-${i.id}`);
    try {
      replace(
        await apiFetch<IdeaView>(`/v1/ideas/${i.id}`, {
          method: 'PUT',
          body: {
            status: e.status,
            response: e.response.trim() || null,
            ...(hidden !== undefined ? { hidden } : {}),
          },
        }),
      );
      setMsg({ tone: 'success', text: `Saved "${i.title}".` });
    } catch (x) {
      setMsg({ tone: 'error', text: errText(x, 'Could not save.') });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      {canPost && (
        <form onSubmit={post} className="space-y-4 rounded-m border border-line bg-surface p-5">
          <h2 className="font-semibold">Suggest an improvement</h2>
          <Field label="Your suggestion in one line" required>
            {(a) => (
              <Input
                {...a}
                value={f.title}
                maxLength={140}
                onChange={(e) => setF({ ...f, title: e.target.value })}
              />
            )}
          </Field>
          <Field label="What would it help you do?" required>
            {(a) => (
              <Textarea
                {...a}
                rows={4}
                value={f.body}
                maxLength={4000}
                onChange={(e) => setF({ ...f, body: e.target.value })}
              />
            )}
          </Field>
          <Field label="Product family">
            {(a) => (
              <Select
                {...a}
                value={f.familyKey}
                onChange={(e) => setF({ ...f, familyKey: e.target.value })}
              >
                <option value="">Not about one product</option>
                {families.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <p className="text-sm text-muted">
            Other customers see your suggestion and can vote for it, but not your name or
            organisation.
          </p>
          <Button
            type="submit"
            busy={busy === 'post'}
            disabled={f.title.trim().length < 8 || f.body.trim().length < 10}
          >
            Post suggestion
          </Button>
        </form>
      )}

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Sort by">
          {(a) => (
            <Select
              {...a}
              value={sort}
              onChange={async (e) => {
                const s = e.target.value as 'top' | 'new';
                setSort(s);
                await reload(s, status);
              }}
            >
              <option value="top">Most votes</option>
              <option value="new">Newest</option>
            </Select>
          )}
        </Field>
        <Field label="Status">
          {(a) => (
            <Select
              {...a}
              value={status}
              onChange={async (e) => {
                const st = e.target.value as '' | IdeaStatus;
                setStatus(st);
                await reload(sort, st);
              }}
            >
              <option value="">Any status</option>
              {IDEA_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {IDEA_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {items.length === 0 ? (
        <EmptyState title="No suggestions yet">
          {canPost ? 'Be the first: tell us what would make WatchDog work better for you.' : ''}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {items.map((i) => {
            const e = edit[i.id] ?? { status: i.status, response: i.response ?? '' };
            return (
              <li key={i.id} className="flex gap-4 py-5">
                <div className="flex w-16 shrink-0 flex-col items-center gap-1">
                  <span className="text-xl font-semibold tabular-nums">{i.votes}</span>
                  <span className="text-xs text-muted">{i.votes === 1 ? 'vote' : 'votes'}</span>
                  {canPost && (
                    <Button
                      size="sm"
                      variant={i.votedByMe ? 'primary' : 'secondary'}
                      busy={busy === i.id}
                      aria-pressed={i.votedByMe}
                      aria-label={`${i.votedByMe ? 'Remove your vote for' : 'Vote for'} ${i.title}`}
                      onClick={() => vote(i)}
                    >
                      {i.votedByMe ? 'Voted' : 'Vote'}
                    </Button>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <h3 className="font-semibold">{i.title}</h3>
                  <p className="text-sm text-muted">
                    <span
                      className={cn(
                        'mr-2 rounded-s border border-line px-1.5 py-0.5 text-xs font-medium text-ink',
                        i.status === 'done' && 'border-ok',
                      )}
                    >
                      {IDEA_STATUS_LABELS[i.status]}
                    </span>
                    {i.familyName ? `${i.familyName}, ` : ''}posted {fmt(i.createdAt)}
                    {i.mine ? ' by you' : ''}
                    {i.postedBy ? ` by ${i.postedBy}` : ''}
                    {i.hidden ? ' (hidden from customers)' : ''}
                  </p>
                  <p className="whitespace-pre-line text-sm">{i.body}</p>
                  {i.response && !canManage && (
                    <p className="border-l-2 border-teal pl-3 text-sm">
                      <span className="font-medium">WatchDog: </span>
                      {i.response}
                    </p>
                  )}
                  {canManage && (
                    <div className="mt-3 grid gap-3 rounded-s border border-line p-3 sm:grid-cols-[12rem_1fr]">
                      <Field label="Status">
                        {(a) => (
                          <Select
                            {...a}
                            value={e.status}
                            onChange={(ev) =>
                              setEdit({
                                ...edit,
                                [i.id]: { ...e, status: ev.target.value as IdeaStatus },
                              })
                            }
                          >
                            {IDEA_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {IDEA_STATUS_LABELS[s]}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <Field label="Reply shown to customers">
                        {(a) => (
                          <Textarea
                            {...a}
                            rows={2}
                            maxLength={2000}
                            value={e.response}
                            onChange={(ev) =>
                              setEdit({ ...edit, [i.id]: { ...e, response: ev.target.value } })
                            }
                          />
                        )}
                      </Field>
                      <div className="flex flex-wrap gap-2 sm:col-span-2">
                        <Button size="sm" busy={busy === `save-${i.id}`} onClick={() => save(i)}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => save(i, !i.hidden)}>
                          {i.hidden ? 'Show to customers' : 'Hide from customers'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
