'use client';
import { useState } from 'react';
import { Button, Field, Notice, Textarea } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const LABELS = ['Very poor', 'Poor', 'Okay', 'Good', 'Excellent'];

export function CsatScale({
  value,
  onChange,
  name,
}: {
  value: number;
  onChange: (v: number) => void;
  name: string;
}) {
  return (
    <fieldset className="mt-6">
      <legend className="text-sm font-medium">Overall rating</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {LABELS.map((l, i) => (
          <label key={l} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={i + 1}
              checked={value === i + 1}
              onChange={() => onChange(i + 1)}
              className="peer sr-only"
            />
            <span className="inline-flex h-10 items-center rounded-s border border-line px-3 text-sm peer-checked:border-navy peer-checked:bg-navy peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-focus">
              <b className="mr-1">{i + 1}</b>
              {l}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function CsatForm({ token }: { token: string }) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (!token)
    return (
      <Notice tone="error" className="mt-6">
        This link is incomplete. Open the link from your resolution email again.
      </Notice>
    );
  if (state === 'done')
    return (
      <Notice tone="success" className="mt-6" title="Thank you">
        Your feedback was recorded.
      </Notice>
    );
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!score) return setError('Choose a rating from 1 to 5.');
        setState('busy');
        setError(null);
        try {
          await apiFetch('/v1/public/csat', {
            method: 'POST',
            body: { token, score, comment: comment || undefined },
          });
          setState('done');
        } catch (err) {
          setState('idle');
          setError(
            err instanceof ClientApiError
              ? err.status === 404
                ? 'This feedback link has expired.'
                : err.title
              : 'Could not send feedback.',
          );
        }
      }}
    >
      <CsatScale value={score} onChange={setScore} name="score" />
      <Field label="Anything we should know?" hint="Optional.">
        {(p) => (
          <Textarea
            {...p}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={2000}
          />
        )}
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" busy={state === 'busy'} className="self-start">
        Send feedback
      </Button>
    </form>
  );
}
