import { notFound } from 'next/navigation';
import type { AuditPage, Me } from '@wd/contracts';
import { AuditView } from '@/components/audit/audit-view';
import { api } from '@/lib/api';

export const metadata = { title: 'Audit trail' };

const PARAMS = ['from', 'to', 'actor', 'action', 'orgId', 'before'] as const;

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('audit:read:all')) notFound();
  const raw = await searchParams;
  const sp = Object.fromEntries(PARAMS.map((k) => [k, raw[k]?.slice(0, 120)]));
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1]));
  const [page, orgs] = await Promise.all([
    api<AuditPage>(`/api/v1/audit-log?${qs}`),
    api<{ items: { id: string; name: string }[] }>('/api/v1/organizations').catch(() => ({
      items: [],
    })),
  ]);
  return (
    <AuditView
      page={page}
      staff
      sp={sp}
      orgs={orgs.items}
      title="Audit trail"
      lead="Every recorded change in the portal, newest first. Entries are chained by hash, so any later change to an entry is detectable."
    />
  );
}
