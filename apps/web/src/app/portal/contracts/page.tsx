import { notFound } from 'next/navigation';
import type { ContractView, Me } from '@wd/contracts';
import { api } from '@/lib/api';
import { Contracts } from './contracts';

export const metadata = { title: 'Contracts and invoices' };
export const dynamic = 'force-dynamic';

export default async function ContractsPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('contract:read:org')) notFound();
  const r = await api<{ items: ContractView[] }>('/api/v1/contracts');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Contracts and invoices</h1>
        <p className="mt-1 max-w-prose text-muted">
          Your support contracts with WatchDog: what each one covers, what it is worth, when it
          ends, and its invoices. Ask to renew a contract here and your account manager will send a
          quote.
        </p>
      </div>
      <Contracts initial={r.items} canRenew={me.permissions.includes('renewal:request')} />
    </div>
  );
}
