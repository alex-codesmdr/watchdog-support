import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AdvisoryView } from '@wd/contracts';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { api, ApiError } from '@/lib/api';
import { Severity } from '../severity';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(iso),
  );

async function load(id: string) {
  if (!/^WDSA-\d{4}-\d{4,}$/.test(id)) notFound();
  try {
    return await api<AdvisoryView>(`/api/v1/advisories/${id}`, { optionalAuth: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const a = await load((await params).id);
  return { title: `${a.wdId}: ${a.title}`, description: a.summary };
}

export default async function AdvisoryPage({ params }: { params: Promise<{ id: string }> }) {
  const a = await load((await params).id);
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-4xl space-y-8 px-4 py-10">
        <nav aria-label="Breadcrumb" className="text-sm">
          <Link href="/advisories" className="text-teal-ink underline underline-offset-2">
            Security advisories
          </Link>
        </nav>
        <header className="space-y-3">
          <p className="font-mono text-sm text-muted">{a.wdId}</p>
          <h1 className="text-3xl font-semibold text-balance">{a.title}</h1>
          <Severity value={a.severity} score={a.cvssScore} className="text-base" />
          {a.status === 'withdrawn' && (
            <p className="rounded-m border border-amber/40 bg-amber/10 px-4 py-3 text-sm">
              <span className="font-semibold">Withdrawn.</span> {a.revisionNote}
            </p>
          )}
        </header>

        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          {a.publishedAt && (
            <>
              <dt className="text-muted">First published</dt>
              <dd>{fmt(a.publishedAt)}</dd>
            </>
          )}
          <dt className="text-muted">Revision</dt>
          <dd>
            {a.revision}
            {a.revision > 1 && a.status !== 'withdrawn' && a.revisionNote && (
              <span className="text-muted">
                , {fmt(a.updatedAt)}: {a.revisionNote}
              </span>
            )}
          </dd>
          {a.cveIds.length > 0 && (
            <>
              <dt className="text-muted">CVE</dt>
              <dd className="flex flex-wrap gap-x-3">
                {a.cveIds.map((c) => (
                  <a
                    key={c}
                    href={`https://nvd.nist.gov/vuln/detail/${c}`}
                    rel="noopener noreferrer"
                    className="font-mono text-teal-ink underline underline-offset-2"
                  >
                    {c}
                  </a>
                ))}
              </dd>
            </>
          )}
          {a.cvssVector && (
            <>
              <dt className="text-muted">CVSS vector</dt>
              <dd className="font-mono break-all">{a.cvssVector}</dd>
            </>
          )}
        </dl>

        {a.yourDevices !== null && (
          <p
            className={
              a.yourDevices > 0
                ? 'rounded-m border border-danger/30 bg-danger/5 px-4 py-3 text-sm'
                : 'rounded-m border border-line px-4 py-3 text-sm'
            }
          >
            {a.yourDevices > 0 ? (
              <>
                <span className="font-semibold">
                  {a.yourDevices} of your installed devices {a.yourDevices === 1 ? 'is an' : 'are'}{' '}
                  affected model{a.yourDevices === 1 ? '' : 's'}.
                </span>{' '}
                Check their software versions against the table below on the{' '}
                <Link href="/portal/assets" className="text-teal-ink underline underline-offset-2">
                  Devices page
                </Link>
                .
              </>
            ) : (
              'None of your installed devices is an affected model.'
            )}
          </p>
        )}

        <section aria-labelledby="sum-h">
          <h2 id="sum-h" className="text-lg font-semibold">
            Summary
          </h2>
          <p className="mt-2 max-w-prose">{a.summary}</p>
        </section>

        <section aria-labelledby="aff-h">
          <h2 id="aff-h" className="text-lg font-semibold">
            Affected products and fixes
          </h2>
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-labelledby="aff-h">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Model</th>
                  <th className="py-2 pr-4 font-medium">Affected versions</th>
                  <th className="py-2 font-medium">Fixed in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {a.affected.map((x) => (
                  <tr key={x.sku}>
                    <td className="py-2 pr-4">{x.modelName}</td>
                    <td className="py-2 pr-4 font-mono">{x.affectedVersions}</td>
                    <td className="py-2 font-mono">
                      {x.fixedVersion ?? <span className="font-sans text-muted">No fix yet</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm">
            Fixed releases are in the{' '}
            <Link href="/downloads" className="text-teal-ink underline underline-offset-2">
              download centre
            </Link>
            .
          </p>
        </section>

        {a.workaroundHtml && (
          <section aria-labelledby="wa-h">
            <h2 id="wa-h" className="text-lg font-semibold">
              Workaround
            </h2>
            {/* Rendered from Markdown and sanitised by the API. */}
            <div
              className="wd-article mt-2"
              dangerouslySetInnerHTML={{ __html: a.workaroundHtml }}
            />
          </section>
        )}
        {a.bodyHtml && (
          <section aria-labelledby="det-h">
            <h2 id="det-h" className="text-lg font-semibold">
              Details
            </h2>
            <div className="wd-article mt-2" dangerouslySetInnerHTML={{ __html: a.bodyHtml }} />
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
