import 'server-only';
import { api } from '@/lib/api';

export interface ReleaseMeta {
  families: { id: string; key: string; name: string }[];
  products: { familyId: string; sku: string; modelName: string }[];
  eulas: { id: string; title: string; version: string }[];
}

export async function loadReleaseMeta(): Promise<ReleaseMeta> {
  const [f, p, e] = await Promise.all([
    api<{ items: ReleaseMeta['families'] }>('/api/v1/catalog/families', { public: true }),
    api<{ items: ReleaseMeta['products'] }>('/api/v1/catalog/products', { public: true }),
    api<{ items: ReleaseMeta['eulas'] }>('/api/v1/admin/releases/eulas'),
  ]);
  return { families: f.items, products: p.items, eulas: e.items };
}
