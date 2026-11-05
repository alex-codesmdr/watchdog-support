import { notFound } from 'next/navigation';
import type { AdvisoryEditorView, Me } from '@wd/contracts';
import { api, ApiError } from '@/lib/api';
import { AdvisoryEditor } from '../editor';

export const metadata = { title: 'Edit advisory' };

export default async function EditAdvisoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('advisory:manage') || !/^WDSA-\d{4}-\d{4,}$/.test(id)) notFound();
  const [a, products] = await Promise.all([
    api<AdvisoryEditorView>(`/api/v1/admin/advisories/${id}`).catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    api<{ items: { sku: string; modelName: string }[] }>('/api/v1/catalog/products', {
      public: true,
    }),
  ]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">
        <span className="font-mono font-normal">{a.wdId}</span> {a.title}
      </h1>
      <AdvisoryEditor products={products.items} advisory={a} />
    </div>
  );
}
