'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { DownloadLink, ReleaseView } from '@wd/contracts';
import { Button, Dialog, Notice } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const size = (n: number) =>
  n >= 1_048_576
    ? `${(n / 1_048_576).toFixed(1)} MB`
    : n >= 1024
      ? `${Math.round(n / 1024)} KB`
      : `${n} bytes`;

interface Eula {
  id: string;
  title: string;
  version: string;
  bodyHtml: string;
}

/** Files of one release with checksum, licence acceptance and a short-lived download link. */
export function ReleaseFiles({ release }: { release: ReleaseView }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [eula, setEula] = useState<Eula | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const go = async (fileId: string) => {
    setBusy(fileId);
    setErr(null);
    try {
      const l = await apiFetch<DownloadLink>(`/v1/downloads/files/${fileId}/link`, {
        method: 'POST',
      });
      window.location.href = l.url.replace(/^https?:\/\/[^/]+\/api\//, '/api/');
    } catch (e) {
      if (
        e instanceof ClientApiError &&
        e.status === 409 &&
        release.eula &&
        /licence/i.test(e.title)
      ) {
        setPending(fileId);
        setEula(await apiFetch<Eula>(`/v1/downloads/eulas/${release.eula.id}`));
      } else setErr(e instanceof ClientApiError ? (e.detail ?? e.title) : 'Download failed');
    } finally {
      setBusy(null);
    }
  };
  const accept = async () => {
    if (!eula || !pending) return;
    setBusy('eula');
    try {
      await apiFetch(`/v1/downloads/eulas/${eula.id}/accept`, { method: 'POST' });
      setEula(null);
      await go(pending);
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.title : 'Could not record your acceptance');
      setBusy(null);
    }
  };
  const copy = async (sha: string) => {
    try {
      await navigator.clipboard.writeText(sha);
      setCopied(sha);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard blocked: the checksum is still selectable */
    }
  };

  return (
    <div className="min-w-0 space-y-3">
      {release.files.map((f) => (
        <div key={f.id} className="rounded-s border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 break-all font-mono text-sm">
              {f.fileName} <span className="font-sans text-muted">({size(f.sizeBytes)})</span>
            </p>
            {release.access === 'download' && (
              <Button
                size="sm"
                busy={busy === f.id}
                disabled={!f.ready}
                onClick={() => go(f.id)}
                aria-label={`Download ${f.fileName}`}
              >
                {f.ready ? 'Download' : 'Checking file'}
              </Button>
            )}
          </div>
          <div className="mt-2 flex items-start gap-2 text-xs">
            <span className="shrink-0 text-muted">SHA-256</span>
            <code className="min-w-0 break-all select-all">{f.sha256}</code>
            <button
              type="button"
              onClick={() => copy(f.sha256)}
              className="shrink-0 rounded-s px-1 font-medium text-teal-ink underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
              aria-label={`Copy SHA-256 of ${f.fileName}`}
            >
              {copied === f.sha256 ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ))}
      {release.access === 'sign_in' && (
        <p className="text-sm">
          <Link
            href={`/auth/login?returnTo=${encodeURIComponent('/downloads')}`}
            className="font-medium text-teal-ink underline underline-offset-2"
          >
            Sign in to download
          </Link>
          {release.visibility === 'entitled' && (
            <span className="text-muted"> (needs an active support contract)</span>
          )}
        </p>
      )}
      {release.access === 'entitlement_required' && (
        <p className="text-sm text-muted">
          Your organisation has no active coverage on a model this release supports.{' '}
          <Link
            href="/portal/assets"
            className="font-medium text-teal-ink underline underline-offset-2"
          >
            Request a renewal quote
          </Link>
        </p>
      )}
      {release.eula && release.access === 'download' && (
        <p className="text-xs text-muted">
          {release.eula.accepted
            ? `You accepted the ${release.eula.title} (${release.eula.version}).`
            : `Downloading asks you to accept the ${release.eula.title}.`}
        </p>
      )}
      {err && <Notice tone="error">{err}</Notice>}

      <Dialog
        open={!!eula}
        onClose={() => setEula(null)}
        title={eula?.title ?? 'Licence agreement'}
      >
        {eula && (
          <>
            <p className="text-sm text-muted">
              Version {eula.version}. You accept once per version.
            </p>
            <div
              className="wd-article max-h-[50vh] overflow-y-auto rounded-s border border-line p-4 text-sm"
              tabIndex={0}
              // Server-rendered from Markdown and sanitised by the API.
              dangerouslySetInnerHTML={{ __html: eula.bodyHtml }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEula(null)}>
                Cancel
              </Button>
              <Button busy={busy === 'eula'} onClick={accept}>
                Accept and download
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
