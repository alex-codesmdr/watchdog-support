import { notFound } from 'next/navigation';
import type { Me, RmaSummary } from '@wd/contracts';
import { RmaList } from '@/components/rma/rma-list';
import { api } from '@/lib/api';

export const metadata = { title: 'Replacements (RMA)' };

export default async function RmasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const status = (await searchParams).status === 'closed' ? 'closed' : 'open';
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.some((p) => p === 'rma:request' || p === 'rma:manage')) notFound();
  const r = await api<{ items: RmaSummary[] }>(`/api/v1/rmas?status=${status}`);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Replacements (RMA)</h1>
        <p className="mt-1 max-w-prose text-muted">
          Hardware replacements requested from your support cases.
        </p>
      </div>
      <RmaList
        items={r.items}
        base="/portal/rmas"
        showOrg={me.org.type !== 'customer'}
        status={status}
      />
    </div>
  );
}
