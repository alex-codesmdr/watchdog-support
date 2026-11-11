'use client';
import { useState } from 'react';
import type { ForumQuestionView } from '@wd/contracts';
import { Button, Field, Input, Notice, Select, Textarea } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

export function AskForm({ families }: { families: { key: string; name: string }[] }) {
  const [f, setF] = useState({ title: '', body: '', familyKey: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="space-y-4 rounded-m border border-line bg-surface p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          const q = await apiFetch<ForumQuestionView>('/v1/community', {
            method: 'POST',
            body: {
              title: f.title.trim(),
              body: f.body.trim(),
              ...(f.familyKey ? { familyKey: f.familyKey } : {}),
            },
          });
          window.location.href = `/community/${q.id}`;
        } catch (x) {
          setErr(
            x instanceof ClientApiError ? (x.detail ?? x.title) : 'Could not post your question.',
          );
          setBusy(false);
        }
      }}
    >
      <h2 className="font-semibold">Ask a question</h2>
      <Field label="Your question" required>
        {(a) => (
          <Input
            {...a}
            maxLength={160}
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
          />
        )}
      </Field>
      <Field
        label="Details"
        required
        hint="Leave out IP addresses, passwords and anything that identifies your network."
      >
        {(a) => (
          <Textarea
            {...a}
            rows={5}
            maxLength={8000}
            value={f.body}
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
            <option value="">Any</option>
            {families.map((x) => (
              <option key={x.key} value={x.key}>
                {x.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {err && <Notice tone="error">{err}</Notice>}
      <Button
        type="submit"
        busy={busy}
        disabled={f.title.trim().length < 10 || f.body.trim().length < 10}
      >
        Post question
      </Button>
    </form>
  );
}
