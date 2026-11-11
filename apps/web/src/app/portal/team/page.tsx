import { notFound } from 'next/navigation';
import type { DelegationView, Me, TeamMember } from '@wd/contracts';
import { api } from '@/lib/api';
import { PartnerAccess } from './partner-access';
import { TeamManager } from './team-manager';

export const metadata = { title: 'Your team' };

export default async function TeamPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('org:users:manage')) notFound();
  const [r, partners] = await Promise.all([
    api<{ items: TeamMember[] }>('/api/v1/org/users'),
    me.org.type === 'customer'
      ? api<{ items: DelegationView[] }>('/api/v1/org/partners')
      : Promise.resolve({ items: [] as DelegationView[] }),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Your team</h1>
        <p className="mt-1 max-w-prose text-muted">
          People at {me.org.name} who can use WatchDog Support. Users open and follow cases;
          administrators can also manage the team, devices, reports and integrations.
        </p>
      </div>
      <TeamManager initial={r.items} />
      {me.org.type === 'customer' && <PartnerAccess initial={partners.items} />}
    </div>
  );
}
