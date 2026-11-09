'use client';
import { Fragment, useState } from 'react';
import Link from 'next/link';
import type { AssistantAnswer } from '@wd/contracts';
import { Button, Notice } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

interface Turn {
  q: string;
  a: AssistantAnswer;
  rated?: boolean;
}

/** Turns "[1]" in the answer into links to the matching article. */
function Cited({ text, sources }: { text: string; sources: AssistantAnswer['sources'] }) {
  return (
    <>
      {text.split(/(\[\d\])/g).map((part, i) => {
        const m = part.match(/^\[(\d)\]$/);
        const s = m ? sources[Number(m[1]) - 1] : undefined;
        return s ? (
          <Link
            key={i}
            href={`/kb/${s.slug}`}
            className="text-teal-ink underline underline-offset-2"
            title={s.title}
          >
            [{m![1]}]
          </Link>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </>
  );
}

export function Assistant({ initial, signedIn }: { initial: string; signedIn: boolean }) {
  const [q, setQ] = useState(initial);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question) return;
    setBusy(true);
    setErr(null);
    try {
      const a = await apiFetch<AssistantAnswer>('/v1/assistant/ask', {
        method: 'POST',
        body: { question },
      });
      setTurns((t) => [{ q: question, a }, ...t].slice(0, 10));
      setQ('');
    } catch (x) {
      setErr(
        x instanceof ClientApiError
          ? x.status === 429
            ? 'You have asked a lot of questions in a short time. Wait a few minutes and try again.'
            : (x.detail ?? x.title)
          : 'The assistant is not available right now. Try searching instead.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function rate(i: number, helpful: boolean) {
    const t = turns[i]!;
    setTurns((xs) => xs.map((x, j) => (j === i ? { ...x, rated: true } : x)));
    await apiFetch(`/v1/assistant/${t.a.id}/feedback`, { method: 'POST', body: { helpful } }).catch(
      () => undefined,
    );
  }

  const caseHref = (question: string) =>
    signedIn
      ? `/portal/cases/new?subject=${encodeURIComponent(question.slice(0, 120))}`
      : '/auth/login?returnTo=%2Fportal%2Fcases%2Fnew';

  return (
    <div className="space-y-6">
      <form onSubmit={ask} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="ask" className="sr-only">
          Your question
        </label>
        <input
          id="ask"
          value={q}
          maxLength={500}
          onChange={(e) => setQ(e.target.value)}
          placeholder="For example: my IPsec tunnel drops every night"
          className="h-11 min-w-0 flex-1 rounded-s border border-line bg-surface px-3"
        />
        <Button type="submit" busy={busy} disabled={q.trim().length < 5}>
          Ask
        </Button>
      </form>
      {err && <Notice tone="error">{err}</Notice>}
      {turns.length === 0 && !busy && (
        <p className="text-sm text-muted">
          Good questions name the product and what you see, such as an error message or which light
          is on.
        </p>
      )}
      <ol className="space-y-6" aria-live="polite">
        {turns.map((t, i) => (
          <li key={t.a.id} className="rounded-m border border-line bg-surface p-4">
            <p className="font-semibold">{t.q}</p>
            <p className="mt-3 whitespace-pre-line">
              <Cited text={t.a.answer} sources={t.a.sources} />
            </p>
            {t.a.sources.length > 0 && (
              <div className="mt-4">
                <h2 className="text-sm font-semibold">Articles used</h2>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
                  {t.a.sources.map((s) => (
                    <li key={s.slug}>
                      <Link
                        href={`/kb/${s.slug}`}
                        className="text-teal-ink underline underline-offset-2"
                      >
                        {s.title}
                      </Link>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              {t.rated ? (
                <span className="text-muted">Thanks for the feedback.</span>
              ) : (
                <>
                  <span className="text-muted">Did this help?</span>
                  <Button size="sm" variant="secondary" onClick={() => rate(i, true)}>
                    Yes
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => rate(i, false)}>
                    No
                  </Button>
                </>
              )}
              <Link
                href={caseHref(t.q)}
                className="ml-auto font-medium text-teal-ink underline underline-offset-2"
              >
                Open a case about this
              </Link>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted">
        Answers are put together automatically from published articles and can miss details. For
        outages, call the P1 line or open a P1 case.
      </p>
    </div>
  );
}
