'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { LowRating } from '@wd/contracts';
import { Button, EmptyState, Field, fmtIst, Notice, Textarea } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

export function LowRatings({ items: initial, all }: { items: LowRating[]; all: boolean }) {
  const [items, setItems] = useState(initial);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ id: string; text: string } | null>(null);

  async function done(r: LowRating) {
    setBusy(r.id);
    setErr(null);
    try {
      await apiFetch(`/v1/workspace/low-ratings/${r.id}`, {
        method: 'POST',
        body: { note: notes[r.id] ?? '' },
      });
      setItems((xs) =>
        all
          ? xs.map((x) =>
              x.id === r.id
                ? {
                    ...x,
                    status: 'done',
                    note: notes[r.id] ?? '',
                    followedUpBy: 'You',
                    followedUpAt: new Date().toISOString(),
                  }
                : x,
            )
          : xs.filter((x) => x.id !== r.id),
      );
    } catch (x) {
      setErr({
        id: r.id,
        text: x instanceof ClientApiError ? (x.detail ?? x.title) : 'Could not save the note.',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm">
        {all ? (
          <Link
            className="text-teal-ink underline underline-offset-2"
            href="/workspace/low-ratings"
          >
            Show only those still to call
          </Link>
        ) : (
          <Link
            className="text-teal-ink underline underline-offset-2"
            href="/workspace/low-ratings?show=all"
          >
            Show those already called back too
          </Link>
        )}
      </p>
      {items.length === 0 ? (
        <EmptyState title="Nobody is waiting for a call back">
          New ratings of 1 or 2 appear here, and support managers get an email.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {items.map((r) => (
            <li key={r.id} className="space-y-3 py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">
                  {r.contactName}, {r.orgName}
                </h2>
                <span className="text-sm text-muted">
                  Rated {r.score} out of 5 on {fmtIst(r.ratedAt)}
                </span>
              </div>
              <p className="text-sm">
                Case{' '}
                <Link
                  className="text-teal-ink underline underline-offset-2"
                  href={`/workspace/cases/${r.caseNumber}`}
                >
                  {r.caseNumber}
                </Link>
                : {r.subject}
              </p>
              {r.comment && (
                <blockquote className="border-l-2 border-line pl-3 text-sm">{r.comment}</blockquote>
              )}
              <p className="text-sm">
                {r.contactPhone ? (
                  <a
                    className="text-teal-ink underline underline-offset-2"
                    href={`tel:${r.contactPhone}`}
                  >
                    {r.contactPhone}
                  </a>
                ) : (
                  <span className="text-muted">No phone number on file.</span>
                )}{' '}
                ·{' '}
                <a
                  className="text-teal-ink underline underline-offset-2"
                  href={`mailto:${r.contactEmail}`}
                >
                  {r.contactEmail}
                </a>
              </p>
              {r.status === 'done' ? (
                <p className="text-sm">
                  <span className="font-medium">
                    Called back by {r.followedUpBy ?? 'a manager'}
                    {r.followedUpAt ? ` on ${fmtIst(r.followedUpAt)}` : ''}:
                  </span>{' '}
                  {r.note}
                </p>
              ) : (
                <div className="space-y-2">
                  <Field label="What you agreed on the call">
                    {(a) => (
                      <Textarea
                        {...a}
                        rows={3}
                        maxLength={2000}
                        value={notes[r.id] ?? ''}
                        onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                      />
                    )}
                  </Field>
                  {err?.id === r.id && <Notice tone="error">{err.text}</Notice>}
                  <Button
                    busy={busy === r.id}
                    disabled={(notes[r.id] ?? '').trim().length < 3}
                    onClick={() => done(r)}
                  >
                    Mark as called back
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
