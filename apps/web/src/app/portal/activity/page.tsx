import { notFound } from 'next/navigation';
import type { AuditPage, Me } from '@wd/contracts';
import { AuditView } from '@/components/audit/audit-view';
import { api } from '@/lib/api';

export const metadata = { title: 'Activity log' };

const PARAMS = ['from', 'to', 'actor', 'action', 'before'] as const;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('audit:read:org')) notFound();
  const raw = await searchParams;
  const sp = Object.fromEntries(PARAMS.map((k) => [k, raw[k]?.slice(0, 120)]));
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1]));
  const page = await api<AuditPage>(`/api/v1/audit-log?${qs}`);
  return (
    <AuditView
      page={page}
      staff={false}
      sp={sp}
      title="Activity log"
      lead="What people in your organisation, and WatchDog Support on your behalf, have done in the portal."
    />
  );
}
