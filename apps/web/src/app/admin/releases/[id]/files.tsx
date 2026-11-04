'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReleaseView } from '@wd/contracts';
import { Button, Notice } from '@wd/ui';
import { apiFetch, ClientApiError, getCsrf } from '@/lib/client';

const size = (n: number) =>
  n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const STATUS: Record<ReleaseView['status'], string> = {
  draft: 'Draft: not visible to customers',
  published: 'Published',
  deprecated: 'Superseded: still downloadable, marked as replaced',
  withdrawn: 'Withdrawn: hidden from customers',
};

/** File upload (streamed, virus-checked) and the publish / supersede / withdraw controls. */
export function ReleaseFilesAdmin({ release }: { release: ReleaseView }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const checking = release.files.some((f) => !f.ready);

  const upload = async () => {
    if (!file) return;
    setBusy('upload');
    setErr(null);
    setMsg(null);
    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'content-type': 'application/octet-stream',
      };
      const csrf = await getCsrf();
      if (csrf) headers['x-wd-csrf'] = csrf;
      const r = await fetch(
        `/api/v1/admin/releases/${release.id}/files?fileName=${encodeURIComponent(file.name)}`,
        { method: 'POST', headers, body: file },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail ?? j.title ?? 'Upload failed');
      setMsg(`Uploaded ${file.name}. SHA-256 ${j.sha256}. The virus check runs now.`);
      setFile(null);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const status = async (s: ReleaseView['status']) => {
    setBusy(s);
    setErr(null);
    setMsg(null);
    try {
      await apiFetch(`/v1/admin/releases/${release.id}/status`, {
        method: 'PATCH',
        body: { status: s },
      });
      router.refresh();
    } catch (e) {
      setErr(e instanceof ClientApiError ? (e.detail ?? e.title) : 'Could not change the status');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="files-h" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="files-h" className="text-lg font-semibold">
          Files and status
        </h2>
        <p className="text-sm">
          <span className="text-muted">Status: </span>
          <span className="font-medium">{STATUS[release.status]}</span>
        </p>
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      {msg && <Notice tone="success">{msg}</Notice>}
      {release.files.length ? (
        <ul className="divide-y divide-line border-y border-line text-sm">
          {release.files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 break-all font-mono">
                {f.fileName} <span className="font-sans text-muted">({size(f.sizeBytes)})</span>
              </span>
              <span className={f.ready ? 'text-ok' : 'text-amber-ink'}>
                {f.ready ? 'Checked' : 'Virus check running'}
              </span>
              <code className="w-full break-all text-xs text-muted">SHA-256 {f.sha256}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No files yet. Add the image or document below.</p>
      )}
      {checking && (
        <Button size="sm" variant="ghost" onClick={() => router.refresh()}>
          Refresh check status
        </Button>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="rel-file" className="block text-sm font-medium">
            Add a file
          </label>
          <input
            id="rel-file"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block text-sm file:mr-3 file:h-9 file:rounded-s file:border file:border-line file:bg-surface file:px-3 file:text-ink"
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!file}
          busy={busy === 'upload'}
          onClick={upload}
        >
          Upload
        </Button>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {release.status !== 'published' && (
          <Button size="sm" busy={busy === 'published'} onClick={() => status('published')}>
            Publish
          </Button>
        )}
        {release.status === 'published' && (
          <Button
            size="sm"
            variant="secondary"
            busy={busy === 'deprecated'}
            onClick={() => status('deprecated')}
          >
            Mark as superseded
          </Button>
        )}
        {release.status !== 'withdrawn' && release.status !== 'draft' && (
          <Button
            size="sm"
            variant="danger"
            busy={busy === 'withdrawn'}
            onClick={() => status('withdrawn')}
          >
            Withdraw
          </Button>
        )}
      </div>
    </section>
  );
}
