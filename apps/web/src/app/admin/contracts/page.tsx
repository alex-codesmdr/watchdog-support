import { notFound } from 'next/navigation';
import type { ContractView, Engineer, Me } from '@wd/contracts';
import { api } from '@/lib/api';
import { ContractsAdmin } from './manager';

export const metadata = { title: 'Contracts and invoices' };
export const dynamic = 'force-dynamic';

export default async function ContractsAdminPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('contract:manage')) notFound();
  const [c, orgs, staff] = await Promise.all([
    api<{ items: ContractView[] }>('/api/v1/admin/contracts'),
    api<{ items: { id: string; name: string; type?: string }[] }>('/api/v1/organizations'),
    api<{ items: Engineer[] }>('/api/v1/workspace/engineers').catch(() => ({ items: [] })),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Contracts and invoices</h1>
        <p className="mt-1 max-w-prose text-muted">
          Each contract groups the device coverage that carries its reference (set in the device
          import). Customer administrators see their contracts and invoices in the portal.
        </p>
      </div>
      <ContractsAdmin
        initial={c.items}
        orgs={orgs.items.filter((o) => o.type === 'customer')}
        staff={staff.items}
      />
    </div>
  );
}
