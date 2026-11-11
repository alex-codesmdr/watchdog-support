import { notFound } from 'next/navigation';
import type { DelegationView, Me } from '@wd/contracts';
import { api } from '@/lib/api';
import { PartnersAdmin } from './manager';

export const metadata = { title: 'Partner access' };
export const dynamic = 'force-dynamic';

type Overview = {
  partners: { id: string; name: string }[];
  customers: { id: string; name: string }[];
  delegations: DelegationView[];
};

export default async function PartnersAdminPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('partner:manage')) notFound();
  const o = await api<Overview>('/api/v1/admin/partners');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Partner access</h1>
        <p className="mt-1 max-w-prose text-muted">
          A partner (reseller) with access to a customer can open and follow that customer&apos;s
          cases and see their devices, never their contracts or invoices. The customer&apos;s
          administrators are emailed and can end the access themselves.
        </p>
      </div>
      <PartnersAdmin {...o} />
    </div>
  );
}
