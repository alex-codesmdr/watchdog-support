import { notFound } from 'next/navigation';
import type { LowRating, Me } from '@wd/contracts';
import { api } from '@/lib/api';
import { LowRatings } from './low-ratings';

export const metadata = { title: 'Low ratings to call back' };
export const dynamic = 'force-dynamic';

export default async function LowRatingsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('csat:followup')) notFound();
  const all = (await searchParams).show === 'all';
  const r = await api<{ items: LowRating[] }>(
    `/api/v1/workspace/low-ratings${all ? '?show=all' : ''}`,
  );
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Low ratings to call back</h1>
        <p className="mt-1 text-muted">
          Customers who rated a case 1 or 2 out of 5. Call each one, listen, and note what you
          agreed. Support managers get an email for every new one.
        </p>
      </div>
      <LowRatings items={r.items} all={all} />
    </div>
  );
}
