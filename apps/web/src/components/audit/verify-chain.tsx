'use client';
import { useState } from 'react';
import { Button } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

/** Recomputes the hash chain on demand and says plainly whether the trail is intact. */
export function VerifyChain() {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<{ tone: string; text: string } | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      const v = await apiFetch<{ intact: boolean; firstBadSeq: number | null; entries: number }>(
        '/v1/audit-log/verify',
      );
      setR(
        v.intact
          ? {
              tone: 'text-ok',
              text: `Intact: all ${v.entries.toLocaleString('en-IN')} entries check out.`,
            }
          : {
              tone: 'text-danger font-semibold',
              text: `Altered: entry ${v.firstBadSeq} no longer matches. Treat this as a security incident.`,
            },
      );
    } catch (e) {
      setR({
        tone: 'text-danger',
        text: e instanceof ClientApiError ? e.title : 'The check could not run',
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-xs text-sm">
      <Button size="sm" variant="secondary" busy={busy} onClick={run}>
        Check the trail has not been altered
      </Button>
      {r && (
        <p role="status" className={`mt-2 ${r.tone}`}>
          {r.text}
        </p>
      )}
    </div>
  );
}
