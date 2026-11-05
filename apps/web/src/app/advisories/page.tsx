import Link from 'next/link';
import { ADVISORY_SEVERITY_LABELS, AdvisorySeverity, type AdvisorySummary } from '@wd/contracts';
import { EmptyState } from '@wd/ui';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { api, currentUser } from '@/lib/api';
import { Severity } from './severity';
import { Subscribe } from './subscribe';
import { portalSettings } from '@/lib/settings';

export const metadata = {
  title: 'Security advisories',
  alternates: {
    types: { 'application/rss+xml': '/api/v1/advisories/rss.xml' },
  },
};

interface Family {
  key: string;
  name: string;
}
const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );

export default async function AdvisoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; family?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const sev = AdvisorySeverity.safeParse(sp.severity).data;
  const qs = new URLSearchParams({
    ...(sev ? { severity: sev } : {}),
    ...(sp.family ? { family: sp.family } : {}),
    ...(sp.q ? { q: sp.q.slice(0, 100) } : {}),
  });
  const [list, fams, me, cfg] = await Promise.all([
    api<{ items: AdvisorySummary[] }>(`/api/v1/advisories?${qs}`, { optionalAuth: true }).catch(
      () => ({ items: [] as AdvisorySummary[] }),
    ),
    api<{ items: Family[] }>('/api/v1/catalog/families', { public: true }).catch(() => ({
      items: [] as Family[],
    })),
    currentUser(),
    portalSettings(),
  ]);
  const filtered = Boolean(sev || sp.family || sp.q);

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-10 lg:grid-cols-[1fr_18rem]">
          <div className="min-w-0 space-y-8">
            <div>
              <h1 className="text-2xl font-semibold">Security advisories</h1>
              <p className="mt-1 max-w-prose text-muted">
                Vulnerabilities in WatchDog products, how serious they are, which versions are
                affected and which release fixes them.
              </p>
            </div>

            <form
              className="flex flex-wrap items-end gap-3"
              role="search"
              aria-label="Filter advisories"
            >
              <label className="flex w-full flex-col gap-1.5 text-sm font-medium sm:w-44">
                Severity
                <select
                  name="severity"
                  defaultValue={sev ?? ''}
                  className="h-10 rounded-s border border-line bg-surface px-3 text-base font-normal"
                >
                  <option value="">Any severity</option>
                  {Object.entries(ADVISORY_SEVERITY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex w-full flex-col gap-1.5 text-sm font-medium sm:w-52">
                Product family
                <select
                  name="family"
                  defaultValue={sp.family ?? ''}
                  className="h-10 rounded-s border border-line bg-surface px-3 text-base font-normal"
                >
                  <option value="">All families</option>
                  {fams.items.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex w-full flex-col gap-1.5 text-sm font-medium sm:w-56">
                Advisory or CVE ID
                <input
                  type="search"
                  name="q"
                  defaultValue={sp.q ?? ''}
                  placeholder="WDSA-2026-0001 or CVE-…"
                  className="h-10 rounded-s border border-line bg-surface px-3 text-base font-normal"
                />
              </label>
              <button
                type="submit"
                className="h-10 rounded-s bg-navy px-4 text-sm font-semibold text-white hover:bg-navy-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Show advisories
              </button>
              {filtered && (
                <Link
                  href="/advisories"
                  className="inline-flex h-10 items-center text-sm font-medium text-teal-ink underline underline-offset-2"
                >
                  Clear filters
                </Link>
              )}
            </form>

            {list.items.length === 0 ? (
              <EmptyState title={filtered ? 'No advisories match' : 'No advisories published'}>
                {filtered
                  ? 'Try another severity or family.'
                  : 'Nothing has been published yet. Subscribe to hear about the first one.'}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line border-y border-line">
                {list.items.map((a) => (
                  <li key={a.wdId} className="py-5">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <Severity value={a.severity} score={a.cvssScore} />
                      <span className="font-mono text-sm text-muted">{a.wdId}</span>
                      {a.publishedAt && (
                        <span className="text-sm text-muted">
                          {a.revision > 1 ? 'Updated' : 'Published'} {fmt(a.updatedAt)}
                        </span>
                      )}
                      {a.status === 'withdrawn' && (
                        <span className="text-sm font-medium text-amber-ink">Withdrawn</span>
                      )}
                    </div>
                    <h2 className="mt-2 text-lg font-semibold">
                      <Link
                        href={`/advisories/${a.wdId}`}
                        className="hover:underline hover:underline-offset-2"
                      >
                        {a.title}
                      </Link>
                    </h2>
                    <p className="mt-1 max-w-prose text-sm">{a.summary}</p>
                    <p className="mt-1 text-sm text-muted">
                      {a.products.map((p) => p.modelName).join(', ')}
                      {a.cveIds.length > 0 && (
                        <span className="font-mono"> {a.cveIds.join(' ')}</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <aside className="space-y-8 text-sm">
            <Subscribe signedIn={!!me} families={fams.items} />
            <section aria-labelledby="rss-h">
              <h2 id="rss-h" className="font-semibold">
                RSS feed
              </h2>
              <p className="mt-1 text-muted">Add this address to your feed reader or SIEM.</p>
              <a
                href="/api/v1/advisories/rss.xml"
                className="mt-1 inline-block font-medium break-all text-teal-ink underline underline-offset-2"
              >
                /api/v1/advisories/rss.xml
              </a>
            </section>
            <section id="report" aria-labelledby="report-h" className="scroll-mt-24">
              <h2 id="report-h" className="font-semibold">
                Report a vulnerability
              </h2>
              <p className="mt-1">
                Email{' '}
                <a
                  href={`mailto:${cfg.securityEmail}`}
                  className="font-medium text-teal-ink underline underline-offset-2"
                >
                  {cfg.securityEmail}
                </a>{' '}
                with the product, version and steps to reproduce. We reply within two business days
                and credit reporters in the advisory if they wish. Please give us time to release a
                fix before disclosing.
              </p>
            </section>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
