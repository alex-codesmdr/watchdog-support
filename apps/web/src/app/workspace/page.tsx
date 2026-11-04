import Link from 'next/link';
import type { CaseSummary, Me } from '@wd/contracts';
import { EmptyState } from '@wd/ui';
import { CaseList } from '@/components/case/case-list';
import { api } from '@/lib/api';

export const metadata = { title: 'Queue' };
const VIEWS = [
  ['queue', 'Unassigned'],
  ['assigned', 'Assigned to me'],
  ['all', 'All open'],
] as const;

export default async function Queue({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; severity?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const me = await api<Me>('/api/v1/me');
  // Staff without case access (content editors) land here after sign-in: show their tools instead.
  if (!me.permissions.includes('case:read:all')) {
    const tools = [
      ['kb:draft', '/workspace/kb', 'Knowledge base editor', 'Write and publish articles.'],
      [
        'release:manage',
        '/admin/releases',
        'Releases',
        'Publish firmware, software and documents.',
      ],
      [
        'asset:import',
        '/admin/imports',
        'Device import',
        'Register customer devices from a spreadsheet.',
      ],
    ].filter(([perm]) => me.permissions.includes(perm!));
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold">Welcome, {me.displayName}</h1>
        <p className="mt-1 text-muted">Your role does not work the case queue. Your tools:</p>
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {tools.map(([, href, label, desc]) => (
            <li key={href} className="py-3">
              <Link href={href!} className="font-medium text-teal-ink underline underline-offset-2">
                {label}
              </Link>
              <p className="text-sm text-muted">{desc}</p>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : 'queue';
  const qs = new URLSearchParams({
    status: 'open',
    limit: '50',
    ...(view !== 'all' ? { scope: view } : {}),
    ...(sp.severity ? { severity: sp.severity } : {}),
    ...(sp.q ? { q: sp.q } : {}),
  });
  const data = await api<{ items: CaseSummary[] }>(`/api/v1/cases?${qs}`);
  // Most urgent first: least SLA time remaining.
  const items = [...data.items].sort(
    (a, b) => (a.nextSla?.remainingSeconds ?? Infinity) - (b.nextSla?.remainingSeconds ?? Infinity),
  );
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Queue</h1>
        <form className="flex flex-wrap gap-2" role="search">
          <input type="hidden" name="view" value={view} />
          <label htmlFor="sev" className="sr-only">
            Severity
          </label>
          <select
            id="sev"
            name="severity"
            defaultValue={sp.severity ?? ''}
            className="h-10 rounded-s border border-line bg-surface px-2"
          >
            <option value="">All severities</option>
            {['P1', 'P2', 'P3', 'P4'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <label htmlFor="wq" className="sr-only">
            Search
          </label>
          <input
            id="wq"
            name="q"
            defaultValue={sp.q}
            placeholder="Number or subject"
            className="h-10 w-56 rounded-s border border-line bg-surface px-3"
          />
          <button className="h-10 rounded-s bg-navy px-4 text-sm font-semibold text-white">
            Filter
          </button>
        </form>
      </div>
      <nav aria-label="Queue views" className="mt-4 flex gap-1 border-b border-line">
        {VIEWS.map(([k, l]) => (
          <Link
            key={k}
            href={`?view=${k}`}
            aria-current={k === view ? 'page' : undefined}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-ink aria-[current=page]:border-teal aria-[current=page]:font-semibold aria-[current=page]:text-ink"
          >
            {l}
          </Link>
        ))}
      </nav>
      <p className="mt-3 text-sm text-muted">Sorted by least SLA time remaining.</p>
      <div className="mt-3">
        {items.length ? (
          <CaseList items={items} base="/workspace/cases" showOrg />
        ) : (
          <EmptyState title="Queue is clear">No open cases match this view.</EmptyState>
        )}
      </div>
    </div>
  );
}
