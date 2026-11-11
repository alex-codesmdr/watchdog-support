import { notFound } from 'next/navigation';
import type { Me, RenewalPipeline } from '@wd/contracts';
import { api } from '@/lib/api';
import { Pipeline } from './pipeline';

export const metadata = { title: 'Renewal pipeline' };
export const dynamic = 'force-dynamic';

export default async function RenewalsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('contract:manage')) notFound();
  const d = Number((await searchParams).days);
  const days = [30, 60, 90, 180, 365].includes(d) ? d : 90;
  const p = await api<RenewalPipeline>(`/api/v1/workspace/renewals?days=${days}`);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Renewal pipeline</h1>
        <p className="mt-1 max-w-prose text-muted">
          Contracts and coverage ending in the next {days} days, and those that ended in the last 30
          days without a decision. Customers get reminders 90, 60 and 30 days before coverage ends;
          each account owner gets this list by email every Monday.
        </p>
      </div>
      <Pipeline p={p} days={days} />
    </div>
  );
}
