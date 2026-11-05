import { notFound } from 'next/navigation';
import type { Me, TeamMember } from '@wd/contracts';
import { api } from '@/lib/api';
import { TeamManager } from './team-manager';

export const metadata = { title: 'Your team' };

export default async function TeamPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('org:users:manage')) notFound();
  const r = await api<{ items: TeamMember[] }>('/api/v1/org/users');
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
    </div>
  );
}
