'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SavedView } from '@wd/contracts';
import { apiFetch, ClientApiError } from '@/lib/client';

const href = (v: SavedView['params']) =>
  `?${new URLSearchParams({ view: v.view, ...(v.severity ? { severity: v.severity } : {}), ...(v.q ? { q: v.q } : {}) })}`;

/** Personal saved queue filters, shown as links above the queue. */
export function SavedViews({
  views,
  current,
}: {
  views: SavedView[];
  current: SavedView['params'];
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await apiFetch('/v1/workspace/views', { method: 'POST', body: { name, params: current } });
      setName('');
      setOpen(false);
      router.refresh();
    } catch (x) {
      setErr(x instanceof ClientApiError ? (x.detail ?? x.title) : 'Could not save');
    }
  }
  async function remove(v: SavedView) {
    await apiFetch(`/v1/workspace/views/${v.id}`, { method: 'DELETE' }).catch(() => undefined);
    router.refresh();
  }

  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-2 text-sm"
      aria-label="Saved views"
      role="group"
    >
      {views.map((v) => (
        <span
          key={v.id}
          className="inline-flex items-center rounded-s border border-line bg-surface"
        >
          <Link href={href(v.params)} className="px-2 py-1 text-teal-ink hover:underline">
            {v.name}
          </Link>
          <button
            type="button"
            onClick={() => remove(v)}
            className="border-l border-line px-2 py-1 text-muted hover:text-ink"
            aria-label={`Delete saved view ${v.name}`}
          >
            ×
          </button>
        </span>
      ))}
      {open ? (
        <form onSubmit={save} className="flex items-center gap-2">
          <label htmlFor="view-name" className="sr-only">
            Name for this view
          </label>
          <input
            id="view-name"
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="Name, e.g. My P1s"
            className="h-8 w-44 rounded-s border border-line bg-surface px-2"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="h-8 rounded-s bg-navy px-3 font-semibold text-white disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-muted underline underline-offset-2"
          >
            Cancel
          </button>
          {err && <span className="text-danger">{err}</span>}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-muted underline underline-offset-2 hover:text-ink"
        >
          Save these filters as a view
        </button>
      )}
    </div>
  );
}
