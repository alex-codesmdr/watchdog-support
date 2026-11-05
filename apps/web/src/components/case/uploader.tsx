'use client';
import { useRef, useState } from 'react';
import { Upload } from 'tus-js-client';
import { Button, cn } from '@wd/ui';
import { getCsrf } from '@/lib/client';

export interface UploadItem {
  key: string;
  name: string;
  size: number;
  progress: number;
  id?: string;
  error?: string;
}

const ALLOWED =
  '.txt,.log,.cfg,.conf,.config,.diag,.out,.csv,.json,.xml,.yaml,.yml,.har,.pcap,.pcapng,.cap,.zip,.gz,.tgz,.tar,.7z,.png,.jpg,.jpeg,.gif,.webp,.pdf,.bin,.dat';
const fmt = (n: number) =>
  n > 1e9
    ? `${(n / 1e9).toFixed(1)} GB`
    : n > 1e6
      ? `${(n / 1e6).toFixed(1)} MB`
      : `${Math.ceil(n / 1e3)} KB`;

/**
 * Resumable uploads (tus). Large tech-support bundles survive flaky links: a dropped
 * connection resumes from the last 8 MB chunk instead of starting over.
 */
export function Uploader({
  items,
  onChange,
}: {
  items: UploadItem[];
  onChange: (f: (prev: UploadItem[]) => UploadItem[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  async function start(files: FileList | null) {
    if (!files) return;
    const csrf = (await getCsrf()) ?? '';
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      onChange((prev) =>
        prev.some((p) => p.key === key)
          ? prev
          : [...prev, { key, name: file.name, size: file.size, progress: 0 }],
      );
      const up = new Upload(file, {
        endpoint: '/api/v1/uploads',
        chunkSize: 8 * 1024 * 1024,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        metadata: { filename: file.name },
        headers: { 'x-wd-csrf': csrf },
        removeFingerprintOnSuccess: true,
        onProgress: (sent, total) =>
          onChange((prev) =>
            prev.map((p) =>
              p.key === key ? { ...p, progress: Math.round((sent / total) * 100) } : p,
            ),
          ),
        onSuccess: () =>
          onChange((prev) =>
            prev.map((p) =>
              p.key === key ? { ...p, progress: 100, id: up.url?.split('/').pop() } : p,
            ),
          ),
        onError: (err) => {
          const status = (
            err as { originalResponse?: { getStatus(): number } }
          ).originalResponse?.getStatus();
          const msg =
            status === 415
              ? 'This file type is not accepted.'
              : status === 413
                ? 'File is larger than the 2 GB limit.'
                : 'Upload failed. Remove it and try again.';
          onChange((prev) => prev.map((p) => (p.key === key ? { ...p, error: msg } : p)));
        },
      });
      const previous = await up.findPreviousUploads();
      if (previous[0]) up.resumeFromPreviousUpload(previous[0]);
      up.start();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void start(e.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col items-start gap-2 rounded-m border border-dashed p-5',
          drag ? 'border-teal bg-teal/5' : 'border-line',
        )}
      >
        <p className="text-sm text-ink">
          Drop logs, diagnostic bundles, packet captures or screenshots here.
        </p>
        <p className="text-xs text-muted">
          Up to 2 GB each. Every file is virus-scanned, and passwords, SNMP communities and keys in
          text files are masked automatically.
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>
          Choose files
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ALLOWED}
          aria-label="Attach files"
          className="sr-only"
          onChange={(e) => void start(e.target.files)}
          tabIndex={-1}
        />
      </div>
      {items.length > 0 && (
        <ul className="divide-y divide-line rounded-m border border-line">
          {items.map((it) => (
            <li key={it.key} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-mono">{it.name}</span>
              <span className="text-muted">{fmt(it.size)}</span>
              {it.error ? (
                <span className="text-danger">{it.error}</span>
              ) : (
                <span className="w-24 tabular-nums text-muted" aria-live="polite">
                  {it.id ? 'Uploaded' : `${it.progress}%`}
                </span>
              )}
              <button
                type="button"
                className="text-muted hover:text-danger"
                aria-label={`Remove ${it.name}`}
                onClick={() => onChange((prev) => prev.filter((p) => p.key !== it.key))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
