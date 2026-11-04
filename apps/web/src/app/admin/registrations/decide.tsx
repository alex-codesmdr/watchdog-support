'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

export function Decide({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async (decision: 'approve' | 'reject') => {
    setBusy(decision);
    try {
      await apiFetch(`/v1/admin/registrations/${id}/decision`, {
        method: 'POST',
        body: { decision },
      });
      router.refresh();
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.title : 'Failed');
      setBusy(null);
    }
  };
  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-sm text-danger">{err}</span>}
      <Button size="sm" busy={busy === 'approve'} onClick={() => go('approve')}>
        Approve
      </Button>
      <Button size="sm" variant="secondary" busy={busy === 'reject'} onClick={() => go('reject')}>
        Reject
      </Button>
    </div>
  );
}
