import { notFound } from 'next/navigation';
import type { Me, ReleaseView } from '@wd/contracts';
import { api, ApiError } from '@/lib/api';
import { loadReleaseMeta } from '../meta';
import { ReleaseForm } from '../release-form';
import { ReleaseFilesAdmin } from './files';

export const metadata = { title: 'Edit release' };

export default async function EditReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('release:manage') || !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const r = await api<ReleaseView>(`/api/v1/downloads/releases/${id}`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold">
        {r.title} <span className="font-mono font-normal">{r.version}</span>
      </h1>
      <ReleaseFilesAdmin release={r} />
      <section aria-labelledby="details" className="space-y-4">
        <h2 id="details" className="text-lg font-semibold">
          Details
        </h2>
        <ReleaseForm meta={await loadReleaseMeta()} release={r} />
      </section>
    </div>
  );
}
