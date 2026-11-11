import { notFound } from 'next/navigation';
import type { Me, ProductLifecycleView } from '@wd/contracts';
import { api } from '@/lib/api';
import { LifecycleManager } from './manager';

export const metadata = { title: 'Product lifecycle' };
export const dynamic = 'force-dynamic';

export default async function LifecyclePage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('catalog:manage')) notFound();
  const r = await api<{ items: ProductLifecycleView[] }>('/api/v1/admin/products');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Product lifecycle</h1>
        <p className="mt-1 max-w-prose text-muted">
          When a model reaches end of sale or end of support, set the dates and an upgrade path.
          Customers see it beside each device they own, and their administrators can be emailed.
        </p>
      </div>
      <LifecycleManager initial={r.items} />
    </div>
  );
}
