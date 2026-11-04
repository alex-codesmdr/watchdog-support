import { notFound } from 'next/navigation';
import type { Me, SlaReport } from '@wd/contracts';
import { EmptyState } from '@wd/ui';
import Link from 'next/link';
import { api } from '@/lib/api';

export const metadata = { title: 'SLA report' };

const METRIC: Record<string, string> = {
  first_response: 'First response',
  update: 'Customer update',
  restoration: 'Restoration',
  resolution: 'Resolution',
};
const TIER: Record<string, string> = {
  standard: 'Standard',
  premium: 'Premium',
  mission_critical: 'Mission-Critical',
};
const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
const pct = (v: number | null) => (v === null ? 'n/a' : `${v}%`);

export default async function SlaReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('report:sla:read')) notFound();
  const sp = await searchParams;
  const qs = new URLSearchParams({
    ...(sp.from ? { from: sp.from } : {}),
    ...(sp.to ? { to: sp.to } : {}),
  });
  const r = await api<SlaReport>(`/api/v1/reports/sla?${qs}`);
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">SLA compliance</h1>
          <p className="mt-1 text-muted">
            Cases opened {r.from} to {r.to} (IST). Compliance counts only clocks that have finished:
            met or breached.
          </p>
        </div>
        <form className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1">
            From
            <input
              type="date"
              name="from"
              defaultValue={r.from}
              className="h-10 rounded-s border border-line bg-surface px-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            To
            <input
              type="date"
              name="to"
              defaultValue={r.to}
              className="h-10 rounded-s border border-line bg-surface px-2"
            />
          </label>
          <button className="h-10 rounded-s bg-navy px-4 font-semibold text-white">Show</button>
        </form>
      </div>

      <p className="mt-6 text-lg">
        Overall: <span className="font-semibold">{pct(r.overallCompliancePct)}</span> of SLA targets
        met
      </p>

      {r.rows.length ? (
        <div className="mt-4 overflow-x-auto rounded-m border border-line bg-surface">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Compliance by tier, severity and SLA metric</caption>
            <thead className="border-b border-line text-muted">
              <tr>
                {['Tier', 'Severity', 'Metric', 'Met', 'Breached', 'Running', 'Compliance'].map(
                  (h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x) => (
                <tr
                  key={`${x.tier}${x.severity}${x.metric}`}
                  className="border-b border-line last:border-0"
                >
                  <td className="px-3 py-2">{TIER[x.tier]}</td>
                  <td className="px-3 py-2">{x.severity}</td>
                  <td className="px-3 py-2">{METRIC[x.metric]}</td>
                  <td className="px-3 py-2 tabular-nums">{x.met}</td>
                  <td
                    className={`px-3 py-2 tabular-nums ${x.breached ? 'font-semibold text-danger' : ''}`}
                  >
                    {x.breached}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{x.running}</td>
                  <td className="px-3 py-2 tabular-nums">{pct(x.compliancePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4">
          <EmptyState title="No cases in this period">Choose a wider date range.</EmptyState>
        </div>
      )}

      <h2 className="mt-10 text-xl font-semibold">Breaches</h2>
      {r.breaches.length ? (
        <ul className="mt-3 divide-y divide-line rounded-m border border-line bg-surface text-sm">
          {r.breaches.map((b) => (
            <li
              key={`${b.caseNumber}${b.metric}`}
              className="grid gap-1 px-4 py-3 md:grid-cols-[8rem_1fr_14rem]"
            >
              <Link
                href={`/workspace/cases/${b.caseNumber}`}
                className="font-mono text-teal-ink underline underline-offset-2"
              >
                {b.caseNumber}
              </Link>
              <span>
                <span className="font-medium">{b.subject}</span>
                <span className="block text-muted">
                  {b.orgName}, {b.severity} {TIER[b.tier]}, now L{Math.min(b.supportLevel, 3)}
                  {b.supportLevel >= 4 ? '/Engineering' : ''}
                  {b.assigneeName ? `, ${b.assigneeName}` : ', unassigned'}
                </span>
              </span>
              <span className="text-danger">
                {METRIC[b.metric]} missed, due {fmt(b.dueAt)}
                {b.metAt ? `, met ${fmt(b.metAt)}` : ', still open'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-ok">No breaches in this period.</p>
      )}
    </div>
  );
}
