import { notFound } from 'next/navigation';
import { LaterPage } from '@/components/later';
import { api } from '@/lib/api';

interface Family {
  id: string;
  key: string;
  name: string;
  description: string;
}
interface Product {
  familyId: string;
  sku: string;
  modelName: string;
  lifecycle: string;
}
const LC: Record<string, string> = {
  ga: 'Available',
  eos_announced: 'End of sale announced',
  eos: 'End of sale',
  eol: 'End of life',
};

export default async function FamilyPage({ params }: { params: Promise<{ family: string }> }) {
  const { family } = await params;
  const [fams, prods] = await Promise.all([
    api<{ items: Family[] }>('/api/v1/catalog/families', { public: true }).catch(() => ({
      items: [] as Family[],
    })),
    api<{ items: Product[] }>('/api/v1/catalog/products', { public: true }).catch(() => ({
      items: [] as Product[],
    })),
  ]);
  const f = fams.items.find((x) => x.key === family);
  if (!f) notFound();
  const list = prods.items.filter((p) => p.familyId === f.id);
  return (
    <LaterPage title={f.name}>
      <p>{f.description}</p>
      <table className="w-full text-left text-sm text-ink">
        <caption className="sr-only">{f.name} models</caption>
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th scope="col" className="py-2 font-medium">
              Model
            </th>
            <th scope="col" className="py-2 font-medium">
              SKU
            </th>
            <th scope="col" className="py-2 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.sku} className="border-b border-line">
              <td className="py-2">{p.modelName}</td>
              <td className="py-2 font-mono">{p.sku}</td>
              <td className="py-2">{LC[p.lifecycle] ?? p.lifecycle}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Datasheets, compatibility and documentation for each model will be linked here.</p>
    </LaterPage>
  );
}
