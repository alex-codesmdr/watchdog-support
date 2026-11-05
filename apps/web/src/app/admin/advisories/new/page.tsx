import { notFound } from 'next/navigation';
import type { Me } from '@wd/contracts';
import { api } from '@/lib/api';
import { AdvisoryEditor } from '../editor';

export const metadata = { title: 'New advisory' };

export default async function NewAdvisoryPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('advisory:manage')) notFound();
  const products = await api<{ items: { sku: string; modelName: string }[] }>(
    '/api/v1/catalog/products',
    { public: true },
  );
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New advisory</h1>
      <AdvisoryEditor products={products.items} />
    </div>
  );
}
