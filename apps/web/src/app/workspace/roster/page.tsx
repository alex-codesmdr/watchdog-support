import { notFound } from 'next/navigation';
import type { Engineer, Me, Roster } from '@wd/contracts';
import { api } from '@/lib/api';
import { RosterView } from './roster';

export const metadata = { title: 'Roster and on call' };
export const dynamic = 'force-dynamic';

export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('case:read:all')) notFound();
  const from = (await searchParams).from;
  const qs = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? `?from=${from}` : '';
  const manage = me.permissions.includes('roster:manage');
  const [r, eng] = await Promise.all([
    api<Roster>(`/api/v1/workspace/roster${qs}`),
    manage
      ? api<{ items: Engineer[] }>('/api/v1/workspace/engineers')
      : Promise.resolve({ items: [] }),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Roster and on call</h1>
        <p className="mt-1 max-w-prose text-muted">
          Routing rules give new cases to engineers on shift first. A P1 that no rule picks up goes
          to whoever carries the P1 phone, who also gets an email and a text for every new P1. Times
          are India time.
        </p>
      </div>
      <RosterView r={r} manage={manage} engineers={eng.items} />
    </div>
  );
}
