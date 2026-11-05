import { notFound } from 'next/navigation';
import type { Me, RoutingOptions, RoutingRule } from '@wd/contracts';
import { api } from '@/lib/api';
import { RoutingManager } from './manager';

export const metadata = { title: 'Case routing' };

export default async function RoutingPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('routing:manage')) notFound();
  const [rules, options] = await Promise.all([
    api<{ items: RoutingRule[] }>('/api/v1/admin/routing/rules'),
    api<RoutingOptions>('/api/v1/admin/routing/options'),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Case routing</h1>
        <p className="mt-1 max-w-prose text-muted">
          When a case is opened, these rules are checked from the top. The first rule that matches
          puts the case in its queue and assigns it to whichever of its engineers has the fewest
          open cases. Cases that match no rule wait in the Unassigned queue.
        </p>
      </div>
      <RoutingManager initial={rules.items} options={options} />
    </div>
  );
}
