import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ADVISORY_SEVERITY_LABELS, type AdvisorySummary, type Me } from '@wd/contracts';
import { EmptyState } from '@wd/ui';
import { api } from '@/lib/api';

export const metadata = { title: 'Advisories (PSIRT)' };

const STATUS = { draft: 'Draft', published: 'Published', withdrawn: 'Withdrawn' } as const;

export default async function AdminAdvisoriesPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('advisory:manage')) notFound();
  const r = await api<{ items: AdvisorySummary[] }>('/api/v1/admin/advisories');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Security advisories</h1>
          <p className="mt-1 max-w-prose text-muted">
            Drafts are visible only to staff. Publishing emails subscribers and the administrators
            of every organisation with an affected device.
          </p>
        </div>
        <Link
          href="/admin/advisories/new"
          className="inline-flex h-10 items-center rounded-s bg-navy dark:bg-teal dark:text-navy px-4 text-sm font-semibold text-white hover:bg-navy-2"
        >
          New advisory
        </Link>
      </div>
      {r.items.length === 0 ? (
        <EmptyState title="No advisories yet">
          Start a draft when a vulnerability is confirmed.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Advisories">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Advisory</th>
                <th className="py-2 pr-4 font-medium">Severity</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Revision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.items.map((a) => (
                <tr key={a.wdId}>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/admin/advisories/${a.wdId}`}
                      className="text-teal-ink underline underline-offset-2"
                    >
                      <span className="font-mono">{a.wdId}</span> {a.title}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{ADVISORY_SEVERITY_LABELS[a.severity]}</td>
                  <td className="py-2 pr-4">{STATUS[a.status]}</td>
                  <td className="py-2 tabular-nums">{a.revision || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
