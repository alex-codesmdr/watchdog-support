import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Me, PartnerCustomer } from '@wd/contracts';
import { EmptyState } from '@wd/ui';
import { api } from '@/lib/api';

export const metadata = { title: 'Your customers' };
export const dynamic = 'force-dynamic';

export default async function PartnerCustomersPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('case:read:delegated')) notFound();
  const r = await api<{ items: PartnerCustomer[] }>('/api/v1/partner/customers');
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Your customers</h1>
        <p className="mt-1 text-muted">
          Customers who use WatchDog through {me.org.name}. You can open and follow their cases and
          see their devices. WatchDog Support decides this access; each customer can end it.
        </p>
      </div>
      {r.items.length === 0 ? (
        <EmptyState title="No customers yet">
          Ask your WatchDog partner manager to give you access to the customers you support.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Customer</th>
                <th className="py-2 pr-4 text-right font-medium">Open cases</th>
                <th className="py-2 pr-4 text-right font-medium">Devices</th>
                <th className="py-2 text-right font-medium">Coverage ending in 60 days</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="py-2 pr-4 font-medium">{c.name}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{c.openCases}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{c.devices}</td>
                  <td className="py-2 text-right tabular-nums">{c.coverageEndingSoon}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm">
        <Link className="text-teal-ink underline underline-offset-2" href="/portal/cases/new">
          Open a case for a customer
        </Link>
      </p>
    </div>
  );
}
