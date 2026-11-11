'use client';
import { useState } from 'react';
import type { ForumQuestionView } from '@wd/contracts';
import { Button, Field, Notice, Textarea, cn } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );

export function Thread({ initial }: { initial: ForumQuestionView }) {
  const [q, setQ] = useState(initial);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function call(key: string, path: string, payload: unknown) {
    setBusy(key);
    setErr(null);
    try {
      setQ(await apiFetch<ForumQuestionView>(path, { method: 'POST', body: payload }));
      return true;
    } catch (x) {
      setErr(x instanceof ClientApiError ? (x.detail ?? x.title) : 'That did not work.');
      return false;
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <article className="space-y-3">
        <h1 className="text-2xl font-semibold">{q.title}</h1>
        <p className="text-sm text-muted">
          Asked by {q.author} on {fmt(q.createdAt)}
          {q.familyName ? `. ${q.familyName}` : ''}
          {q.hidden ? '. Hidden from customers' : ''}
        </p>
        <p className="whitespace-pre-line">{q.body}</p>
        {q.canModerate && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => call('hideq', `/v1/community/${q.id}/hide`, { hidden: !q.hidden })}
          >
            {q.hidden ? 'Show the question again' : 'Hide this question'}
          </Button>
        )}
      </article>

      <section aria-labelledby="answers" className="space-y-4">
        <h2 id="answers" className="text-lg font-semibold">
          {q.answers === 0 ? 'No answers yet' : `${q.answers} answer${q.answers === 1 ? '' : 's'}`}
        </h2>
        {err && <Notice tone="error">{err}</Notice>}
        <ul className="space-y-4">
          {q.answerList.map((a) => (
            <li
              key={a.id}
              className={cn(
                'rounded-m border p-4',
                a.accepted ? 'border-ok' : 'border-line',
                a.hidden && 'opacity-60',
              )}
            >
              {a.accepted && (
                <p className="mb-2 text-sm font-semibold text-ok">Marked as the answer</p>
              )}
              <p className="whitespace-pre-line">{a.body}</p>
              <p className="mt-2 text-sm text-muted">
                {a.author}
                {a.byStaff ? ', WatchDog engineer' : ''}, {fmt(a.createdAt)}
                {a.hidden ? '. Hidden from customers' : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                {q.canAccept && !a.hidden && (
                  <button
                    type="button"
                    className="text-teal-ink underline underline-offset-2"
                    disabled={busy === `acc-${a.id}`}
                    onClick={() =>
                      call(`acc-${a.id}`, `/v1/community/${q.id}/accept`, {
                        answerId: a.accepted ? null : a.id,
                      })
                    }
                  >
                    {a.accepted ? 'Unmark as the answer' : 'Mark as the answer'}
                  </button>
                )}
                {q.canModerate && (
                  <button
                    type="button"
                    className="text-teal-ink underline underline-offset-2"
                    onClick={() =>
                      call(`hide-${a.id}`, `/v1/community/${q.id}/answers/${a.id}/hide`, {
                        hidden: !a.hidden,
                      })
                    }
                  >
                    {a.hidden ? 'Show again' : 'Hide'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call('answer', `/v1/community/${q.id}/answers`, { body: body.trim() }))
              setBody('');
          }}
        >
          <Field label="Your answer">
            {(a) => (
              <Textarea
                {...a}
                rows={4}
                maxLength={8000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" busy={busy === 'answer'} disabled={body.trim().length < 2}>
            Post answer
          </Button>
        </form>
      </section>
    </>
  );
}
