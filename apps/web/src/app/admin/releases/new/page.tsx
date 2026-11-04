import { notFound } from 'next/navigation';
import type { Me } from '@wd/contracts';
import { api } from '@/lib/api';
import { loadReleaseMeta } from '../meta';
import { ReleaseForm } from '../release-form';

export const metadata = { title: 'New release' };

export default async function NewReleasePage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('release:manage')) notFound();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New release</h1>
      <ReleaseForm meta={await loadReleaseMeta()} />
    </div>
  );
}
