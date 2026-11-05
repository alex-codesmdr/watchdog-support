import Link from 'next/link';
import type { AssetSummary, CaseSummary } from '@wd/contracts';
import { EmptyState } from '@wd/ui';
import { CaseList } from '@/components/case/case-list';
import { api } from '@/lib/api';

export const metadata = { title: 'Dashboard' };

export default async function Dashboard() {
  const [cases, assets] = await Promise.all([
    api<{ items: CaseSummary[] }>('/api/v1/cases?status=open&limit=10'),
    api<{ items: AssetSummary[] }>('/api/v1/assets').catch(() => ({ items: [] as AssetSummary[] })),
  ]);
  const soon = assets.items
    .map((a) => ({
      a,
      days: a.entitlement
        ? Math.ceil((new Date(a.entitlement.endsOn).getTime() - Date.now()) / 86_400_000)
        : -1,
    }))
    .filter((x) => x.days >= 0 && x.days <= 90)
    .sort((x, y) => x.days - y.days);
  const uncovered = assets.items.filter((a) => !a.entitlement);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
      <section aria-labelledby="open">
        <div className="flex items-baseline justify-between gap-4">
          <h1 id="open" className="text-2xl font-semibold">
            Open cases
          </h1>
          <Link
            href="/portal/cases"
            className="text-sm font-medium text-teal-ink underline underline-offset-2"
          >
            All cases
          </Link>
        </div>
        <div className="mt-4">
          {cases.items.length ? (
            <CaseList items={cases.items} base="/portal/cases" />
          ) : (
            <EmptyState
              title="No open cases"
              action={
                <Link
                  href="/portal/cases/new"
                  className="inline-flex h-10 items-center rounded-s bg-navy px-4 text-sm font-semibold text-white hover:bg-navy-2"
                >
                  Open a case
                </Link>
              }
            >
              When something on your network needs attention, open a case and the SLA clock starts
              immediately.
            </EmptyState>
          )}
        </div>
      </section>
      <aside className="space-y-8">
        <section aria-labelledby="cov">
          <h2 id="cov" className="text-lg font-semibold">
            Coverage
          </h2>
          <p className="mt-1 text-sm text-muted">{assets.items.length} registered devices</p>
          {soon.length > 0 && (
            <ul className="mt-3 space-y-2 text-sm">
              {soon.map(({ a, days }) => (
                <li key={a.id} className="flex justify-between gap-3 border-b border-line pb-2">
                  <span>
                    <span className="font-mono">{a.serialNumber}</span>
                    <br />
                    <span className="text-muted">{a.modelName}</span>
                  </span>
                  <span className={days <= 30 ? 'font-semibold text-danger' : 'text-amber-ink'}>
                    {days} days left
                  </span>
                </li>
              ))}
            </ul>
          )}
          {uncovered.length > 0 && (
            <p className="mt-3 text-sm text-amber-ink">
              {uncovered.length} device{uncovered.length > 1 ? 's have' : ' has'} no active
              contract. Ask your account manager for a renewal quote.
            </p>
          )}
          {!soon.length && !uncovered.length && assets.items.length > 0 && (
            <p className="mt-3 text-sm text-ok">All devices are covered for at least 90 days.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
