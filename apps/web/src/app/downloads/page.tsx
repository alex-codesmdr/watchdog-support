import Link from 'next/link';
import { RELEASE_KIND_LABELS, type ReleaseKind, type ReleaseView } from '@wd/contracts';
import { EmptyState } from '@wd/ui';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { api } from '@/lib/api';
import { ReleaseFiles } from './release-files';

export const metadata = { title: 'Downloads' };

interface Family {
  id: string;
  key: string;
  name: string;
}
interface Product {
  familyId: string;
  sku: string;
  modelName: string;
  lifecycle: 'ga' | 'eos_announced' | 'eos' | 'eol';
}
const LIFECYCLE: Record<Product['lifecycle'], string> = {
  ga: 'Available',
  eos_announced: 'End of sale announced',
  eos: 'End of sale',
  eol: 'End of life',
};
const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${d}T00:00:00`),
  );

export default async function DownloadsPage({
  searchParams,
}: {
  searchParams: Promise<{ family?: string; kind?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const kind = sp.kind && sp.kind in RELEASE_KIND_LABELS ? (sp.kind as ReleaseKind) : undefined;
  const qs = new URLSearchParams({
    ...(sp.family ? { family: sp.family } : {}),
    ...(kind ? { kind } : {}),
    ...(sp.q ? { q: sp.q.slice(0, 100) } : {}),
  });
  const [releases, fams, prods] = await Promise.all([
    api<{ items: ReleaseView[] }>(`/api/v1/downloads?${qs}`, { optionalAuth: true }).catch(() => ({
      items: [] as ReleaseView[],
    })),
    api<{ items: Family[] }>('/api/v1/catalog/families', { public: true }).catch(() => ({
      items: [] as Family[],
    })),
    api<{ items: Product[] }>('/api/v1/catalog/products', { public: true }).catch(() => ({
      items: [] as Product[],
    })),
  ]);
  const fam = fams.items.find((f) => f.key === sp.family);
  const ending = prods.items.filter((p) => p.lifecycle !== 'ga' && (!fam || p.familyId === fam.id));
  const groups = fams.items
    .map((f) => ({ f, items: releases.items.filter((r) => r.family.key === f.key) }))
    .filter((g) => g.items.length);
  const filtered = Boolean(sp.family || kind || sp.q);

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl space-y-8 px-4 py-10">
        <div>
          <h1 className="text-2xl font-semibold">Downloads</h1>
          <p className="mt-1 max-w-prose text-muted">
            Firmware, software, release notes, MIBs and documents for WatchDog products. Check the
            SHA-256 of every image before you install it. Firmware needs an active support contract
            on a compatible device.
          </p>
        </div>

        <form
          className="flex flex-wrap items-end gap-3"
          role="search"
          aria-label="Filter downloads"
        >
          <label className="flex w-full flex-col gap-1.5 text-sm font-medium sm:w-56">
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
          <label className="flex w-full flex-col gap-1.5 text-sm font-medium sm:w-44">
            Type
            <select
              name="kind"
              defaultValue={kind ?? ''}
              className="h-10 rounded-s border border-line bg-surface px-3 text-base font-normal"
            >
              <option value="">All types</option>
              {Object.entries(RELEASE_KIND_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-full flex-col gap-1.5 text-sm font-medium sm:w-56">
            Model or version
            <input
              type="search"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="SW5600 or 7.1.075"
              className="h-10 rounded-s border border-line bg-surface px-3 text-base font-normal"
            />
          </label>
          <button
            type="submit"
            className="h-10 rounded-s bg-navy dark:bg-teal dark:text-navy px-4 text-sm font-semibold text-white hover:bg-navy-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Show downloads
          </button>
          {filtered && (
            <Link
              href="/downloads"
              className="inline-flex h-10 items-center text-sm font-medium text-teal-ink underline underline-offset-2"
            >
              Clear filters
            </Link>
          )}
        </form>

        {ending.length > 0 && (
          <section
            aria-labelledby="eol"
            className="rounded-m border border-amber/40 bg-amber/10 px-4 py-3 text-sm"
          >
            <h2 id="eol" className="font-semibold">
              Lifecycle notices
            </h2>
            <ul className="mt-1 space-y-0.5">
              {ending.map((p) => (
                <li key={p.sku}>
                  {p.modelName} ({p.sku}): {LIFECYCLE[p.lifecycle]}. Plan a replacement with your
                  account manager; software fixes continue until end of life.
                </li>
              ))}
            </ul>
          </section>
        )}

        {groups.length === 0 ? (
          <EmptyState title={filtered ? 'Nothing matches these filters' : 'No downloads yet'}>
            {filtered
              ? 'Try another family or type, or clear the filters.'
              : 'Published releases will appear here.'}
          </EmptyState>
        ) : (
          groups.map(({ f, items }) => (
            <section key={f.key} aria-labelledby={`fam-${f.key}`}>
              <h2 id={`fam-${f.key}`} className="border-b border-line pb-2 text-lg font-semibold">
                {f.name}
              </h2>
              <ul className="divide-y divide-line">
                {items.map((r) => (
                  <li
                    key={r.id}
                    className="grid gap-4 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]"
                  >
                    <div className="min-w-0">
                      <h3 className="font-semibold">
                        {r.title}{' '}
                        {r.kind !== 'release_notes' && (
                          <span className="font-mono font-normal">{r.version}</span>
                        )}
                      </h3>
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
                        <span>{RELEASE_KIND_LABELS[r.kind]}</span>
                        {r.releasedOn && <span>Released {fmtDate(r.releasedOn)}</span>}
                        {r.recommended && r.status === 'published' && (
                          <span className="font-medium text-ok">Recommended</span>
                        )}
                        {r.status === 'deprecated' && (
                          <span className="font-medium text-amber-ink">Superseded</span>
                        )}
                      </p>
                      {r.products.length > 0 && (
                        <p className="mt-1 text-sm">
                          <span className="text-muted">For </span>
                          {r.products.map((p) => p.modelName).join(', ')}
                        </p>
                      )}
                    </div>
                    <ReleaseFiles release={r} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
      <SiteFooter />
    </>
  );
}
