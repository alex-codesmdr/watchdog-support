import { notFound } from 'next/navigation';
import type { Me, StockView } from '@wd/contracts';
import { api } from '@/lib/api';
import { StockManager } from './manager';

export const metadata = { title: 'Spare stock' };
export const dynamic = 'force-dynamic';

export default async function StockPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('stock:manage') && !me.permissions.includes('rma:manage'))
    notFound();
  const s = await api<StockView>('/api/v1/workspace/stock');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Spare stock</h1>
        <p className="mt-1 max-w-prose text-muted">
          Replacement units at each depot, by model. Shipping a spare on a replacement (RMA) takes
          it out of stock; RMA coordinators are emailed when a depot falls below its minimum.
        </p>
      </div>
      <StockManager initial={s} canManage={me.permissions.includes('stock:manage')} />
    </div>
  );
}
