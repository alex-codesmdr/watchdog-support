import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RELEASE_KIND_LABELS, type Me, type ReleaseView } from '@wd/contracts';
import { EmptyState } from '@wd/ui';
import { api } from '@/lib/api';

export const metadata = { title: 'Releases' };

const VIS: Record<ReleaseView['visibility'], string> = {
  public: 'Everyone',
  registered: 'Signed-in customers',
  entitled: 'Covered customers',
  internal: 'Staff only',
};
const STATUS: Record<ReleaseView['status'], string> = {
  draft: 'Draft',
  published: 'Published',
  deprecated: 'Superseded',
  withdrawn: 'Withdrawn',
};

export default async function ReleasesPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('release:manage')) notFound();
  const r = await api<{ items: ReleaseView[] }>('/api/v1/admin/releases');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Releases</h1>
          <p className="mt-1 max-w-prose text-muted">
            Firmware, software and documents in the download centre. Files are virus-checked before
            anyone can download them.
          </p>
        </div>
        <Link
          href="/admin/releases/new"
          className="inline-flex h-10 items-center rounded-s bg-navy dark:bg-teal dark:text-navy px-4 text-sm font-semibold text-white hover:bg-navy-2"
        >
          New release
        </Link>
      </div>
      {r.items.length === 0 ? (
        <EmptyState title="No releases yet">Create a release, then add its files.</EmptyState>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Releases">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Release</th>
                <th className="py-2 pr-4 font-medium">Family</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Who can download</th>
                <th className="py-2 pr-4 font-medium">Files</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.items.map((x) => (
                <tr key={x.id}>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/admin/releases/${x.id}`}
                      className="font-medium text-teal-ink underline underline-offset-2"
                    >
                      {x.title} {x.version}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{x.family.name}</td>
                  <td className="py-2 pr-4">{RELEASE_KIND_LABELS[x.kind]}</td>
                  <td className="py-2 pr-4">{VIS[x.visibility]}</td>
                  <td className="py-2 pr-4 tabular-nums">{x.files.length}</td>
                  <td className="py-2">{STATUS[x.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
