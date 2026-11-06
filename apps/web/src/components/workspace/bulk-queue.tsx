'use client';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { BulkAssignResult, Engineer } from '@wd/contracts';
import { Button, Notice } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

/** Wraps a selectable case list with an "assign selected" bar. */
export function BulkQueue({
  engineers,
  meId,
  children,
}: {
  engineers: Engineer[];
  meId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [to, setTo] = useState(
    engineers.some((e) => e.id === meId) ? meId : (engineers[0]?.id ?? ''),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(
    null,
  );

  const read = (root: HTMLElement) =>
    setPicked(
      [...root.querySelectorAll<HTMLInputElement>('input[name="case"]:checked')].map(
        (i) => i.value,
      ),
    );

  async function assign(root: HTMLElement | null) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<BulkAssignResult>('/v1/workspace/bulk-assign', {
        method: 'POST',
        body: { numbers: picked, assigneeId: to || null },
      });
      const failed = r.results.filter((x) => !x.ok);
      const who = to ? (engineers.find((e) => e.id === to)?.name ?? 'the engineer') : 'nobody';
      setMsg(
        failed.length
          ? {
              tone: 'warning',
              text: `Assigned ${r.results.length - failed.length} to ${who}. Not assigned: ${failed.map((f) => `${f.number} (${f.error})`).join('; ')}`,
            }
          : {
              tone: 'success',
              text: `Assigned ${r.results.length} case${r.results.length > 1 ? 's' : ''} to ${who}.`,
            },
      );
      root
        ?.querySelectorAll<HTMLInputElement>('input[name="case"]')
        .forEach((i) => (i.checked = false));
      setPicked([]);
      router.refresh();
    } catch (err) {
      setMsg({
        tone: 'error',
        text: err instanceof ClientApiError ? (err.detail ?? err.title) : 'Could not assign',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onChange={(e) => {
        const t = e.target as HTMLInputElement;
        if (t.name === 'case') read(e.currentTarget);
      }}
    >
      {msg && (
        <Notice tone={msg.tone} className="mb-3">
          {msg.text}
        </Notice>
      )}
      <div
        className="mb-3 flex flex-wrap items-center gap-2 rounded-m border border-line bg-surface px-3 py-2 text-sm"
        role="group"
        aria-label="Assign selected cases"
      >
        <span className="tabular-nums text-muted">
          {picked.length ? `${picked.length} selected` : 'Tick cases to assign several at once'}
        </span>
        <label htmlFor="bulk-to" className="ml-auto">
          Assign to
        </label>
        <select
          id="bulk-to"
          value={to}
          onChange={(e) => {
            e.stopPropagation();
            setTo(e.target.value);
          }}
          className="h-9 rounded-s border border-line bg-surface px-2"
        >
          {engineers.map((e) => (
            <option key={e.id} value={e.id}>
              {e.id === meId ? `Me (${e.name})` : e.name}, {e.openCases} open
            </option>
          ))}
          <option value="">Nobody (unassign)</option>
        </select>
        <Button
          size="sm"
          busy={busy}
          disabled={!picked.length}
          onClick={(e) => assign((e.currentTarget as HTMLElement).closest('[data-bulk]'))}
        >
          Assign selected
        </Button>
      </div>
      <div data-bulk>{children}</div>
    </div>
  );
}
