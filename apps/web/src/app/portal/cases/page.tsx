import Link from 'next/link';
import type { CaseSummary } from '@wd/contracts';
import { EmptyState } from '@wd/ui';
import { CaseList } from '@/components/case/case-list';
import { api } from '@/lib/api';
import { serverT } from '@/lib/locale';

export const metadata = { title: 'Cases' };
const TABS = [
  ['open', 'Open'],
  ['closed', 'Resolved and closed'],
  ['all', 'All'],
] as const;

export default async function Cases({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; cursor?: string }>;
}) {
  const sp = await searchParams;
  const tr = await serverT();
  const status = TABS.some(([k]) => k === sp.status) ? sp.status! : 'open';
  const qs = new URLSearchParams({
    status,
    limit: '25',
    ...(sp.q ? { q: sp.q } : {}),
    ...(sp.cursor ? { cursor: sp.cursor } : {}),
  });
  const data = await api<{ items: CaseSummary[]; nextCursor: string | null }>(
    `/api/v1/cases?${qs}`,
  );
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">{tr('Cases')}</h1>
        <form className="flex gap-2" role="search">
          <input type="hidden" name="status" value={status} />
          <label htmlFor="cq" className="sr-only">
            {tr('Search cases')}
          </label>
          <input
            id="cq"
            name="q"
            defaultValue={sp.q}
            placeholder={tr('Case number or subject')}
            className="h-10 w-64 rounded-s border border-line bg-surface px-3"
          />
        </form>
      </div>
      <nav aria-label={tr('Case filters')} className="mt-4 flex gap-1 border-b border-line">
        {TABS.map(([k, l]) => (
          <Link
            key={k}
            href={`?status=${k}`}
            aria-current={k === status ? 'page' : undefined}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-ink aria-[current=page]:border-teal aria-[current=page]:font-semibold aria-[current=page]:text-ink"
          >
            {tr(l)}
          </Link>
        ))}
      </nav>
      <div className="mt-4">
        {data.items.length ? (
          <CaseList items={data.items} base="/portal/cases" />
        ) : (
          <EmptyState
            title={sp.q ? tr('No cases match “{q}”', { q: sp.q }) : tr('Nothing here yet')}
          >
            {tr('Try another filter, or open a new case.')}
          </EmptyState>
        )}
      </div>
      {data.nextCursor && (
        <p className="mt-4">
          <Link
            className="text-sm font-medium text-teal-ink underline underline-offset-2"
            href={`?${new URLSearchParams({ status, ...(sp.q ? { q: sp.q } : {}), cursor: data.nextCursor })}`}
          >
            {tr('Older cases')}
          </Link>
        </p>
      )}
    </div>
  );
}
