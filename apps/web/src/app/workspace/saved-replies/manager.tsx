'use client';
import { useState } from 'react';
import { SAVED_REPLY_PLACEHOLDERS, type SavedReply } from '@wd/contracts';
import { Button, EmptyState, Field, Input, Notice, Textarea } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

interface Form {
  id: string | null;
  title: string;
  body: string;
  shared: boolean;
}
const blank: Form = { id: null, title: '', body: '', shared: false };

export function SavedRepliesManager({
  initial,
  canShare,
}: {
  initial: SavedReply[];
  canShare: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [f, setF] = useState<Form>(blank);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const fail = (err: unknown, fallback: string) =>
    setMsg({
      tone: 'error',
      text: err instanceof ClientApiError ? (err.detail ?? err.title) : fallback,
    });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    setMsg(null);
    try {
      const r = await apiFetch<SavedReply>(
        f.id ? `/v1/saved-replies/${f.id}` : '/v1/saved-replies',
        { method: f.id ? 'PUT' : 'POST', body: { title: f.title, body: f.body, shared: f.shared } },
      );
      setItems((xs) =>
        [r, ...xs.filter((x) => x.id !== r.id)].sort(
          (a, b) => Number(a.shared) - Number(b.shared) || a.title.localeCompare(b.title),
        ),
      );
      setMsg({ tone: 'success', text: `Saved: ${r.title}` });
      setF(blank);
    } catch (err) {
      fail(err, 'Could not save');
    } finally {
      setBusy(null);
    }
  }

  async function remove(r: SavedReply) {
    setBusy(r.id);
    try {
      await apiFetch(`/v1/saved-replies/${r.id}`, { method: 'DELETE' });
      setItems((xs) => xs.filter((x) => x.id !== r.id));
      setMsg({ tone: 'success', text: `Deleted: ${r.title}` });
      if (f.id === r.id) setF(blank);
    } catch (err) {
      fail(err, 'Could not delete');
    } finally {
      setBusy(null);
    }
  }

  const groups: [string, SavedReply[]][] = [
    ['Your replies', items.filter((i) => !i.shared)],
    ['Shared with every engineer', items.filter((i) => i.shared)],
  ];

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
      <div className="space-y-6">
        {items.length === 0 && (
          <EmptyState title="No saved replies yet">
            Save the replies you type most, such as asking for logs or confirming a fix.
          </EmptyState>
        )}
        {groups
          .filter(([, xs]) => xs.length)
          .map(([label, xs]) => (
            <section key={label} aria-label={label}>
              <h2 className="text-sm font-semibold text-muted">{label}</h2>
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {xs.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{r.title}</p>
                      <p className="line-clamp-2 whitespace-pre-line text-sm text-muted">
                        {r.body}
                      </p>
                    </div>
                    {r.editable && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            setF({ id: r.id, title: r.title, body: r.body, shared: r.shared })
                          }
                          aria-label={`Edit: ${r.title}`}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          busy={busy === r.id}
                          onClick={() => remove(r)}
                          aria-label={`Delete: ${r.title}`}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>

      <form
        onSubmit={save}
        className="flex flex-col gap-4 self-start rounded-m border border-line bg-surface p-4"
      >
        <h2 className="font-semibold">{f.id ? 'Edit saved reply' : 'New saved reply'}</h2>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <Field label="Name" required hint="What you will pick from the list.">
          {(p) => (
            <Input
              {...p}
              value={f.title}
              maxLength={80}
              onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))}
            />
          )}
        </Field>
        <Field
          label="Reply text"
          required
          hint={
            <>
              These fill in from the case:{' '}
              {Object.entries(SAVED_REPLY_PLACEHOLDERS).map(([k, v], i) => (
                <span key={k}>
                  {i > 0 && ', '}
                  <code className="font-mono">{k}</code> ({v.toLowerCase()})
                </span>
              ))}
              .
            </>
          }
        >
          {(p) => (
            <Textarea
              {...p}
              value={f.body}
              rows={8}
              maxLength={5000}
              onChange={(e) => setF((x) => ({ ...x, body: e.target.value }))}
            />
          )}
        </Field>
        {canShare && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.shared}
              onChange={(e) => setF((x) => ({ ...x, shared: e.target.checked }))}
            />
            Share with every engineer
          </label>
        )}
        <div className="flex gap-2">
          <Button
            type="submit"
            busy={busy === 'save'}
            disabled={f.title.trim().length < 3 || !f.body.trim()}
          >
            {f.id ? 'Save changes' : 'Save reply'}
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
