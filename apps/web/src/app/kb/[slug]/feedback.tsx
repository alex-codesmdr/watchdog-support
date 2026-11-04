'use client';
import { useState } from 'react';
import { Button, Textarea } from '@wd/ui';
import { apiFetch } from '@/lib/client';

export function Feedback({ slug }: { slug: string }) {
  const [state, setState] = useState<'ask' | 'comment' | 'done'>('ask');
  const [comment, setComment] = useState('');
  const send = async (helpful: boolean, c?: string) => {
    await apiFetch(`/v1/kb/articles/${slug}/feedback`, {
      method: 'POST',
      body: { helpful, comment: c || undefined },
    }).catch(() => undefined);
    setState('done');
  };
  return (
    <section
      aria-label="Article feedback"
      className="mt-12 border-t border-line pt-6"
      aria-live="polite"
    >
      {state === 'done' && (
        <p className="text-ok">Thanks. Your feedback helps us improve this article.</p>
      )}
      {state === 'ask' && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">Did this solve your problem?</span>
          <Button size="sm" variant="secondary" onClick={() => send(true)}>
            Yes
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setState('comment')}>
            No
          </Button>
        </div>
      )}
      {state === 'comment' && (
        <form
          className="flex max-w-xl flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(false, comment);
          }}
        >
          <label htmlFor="fb" className="font-medium">
            What was missing or wrong?
          </label>
          <Textarea
            id="fb"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={2000}
          />
          <Button type="submit" size="sm" className="self-start">
            Send feedback
          </Button>
        </form>
      )}
    </section>
  );
}
