import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ManagementDashboard, Me } from '@wd/contracts';
import { MonthBars, MonthLine } from '@/components/reports/month-charts';
import { Bars, Tile } from '@/components/reports/ops-report';
import { api } from '@/lib/api';

export const metadata = { title: 'Management dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('report:ops:read:all')) notFound();
  const d = await api<ManagementDashboard>('/api/v1/workspace/dashboard');
  const n = d.now;
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Management dashboard</h1>
        <p className="mt-1 text-muted">
          The last six months across every customer, and the queue as it stands now. Months are
          India time; the current month is still running.
        </p>
      </div>

      <section aria-labelledby="now" className="space-y-3">
        <h2 id="now" className="text-sm font-semibold">
          Right now
        </h2>
        <dl className="grid grid-cols-2 gap-6 sm:grid-cols-5">
          <Tile label="Open cases" value={String(n.openCases)} />
          <Tile label="Open P1 cases" value={String(n.openP1)} />
          <Tile label="Not assigned" value={String(n.unassigned)} />
          <Tile label="Past an SLA target" value={String(n.breachedOpen)} />
          <Tile label="Low ratings to call back" value={String(n.lowRatingsWaiting)} />
        </dl>
        <p className="flex flex-wrap gap-x-5 text-sm">
          <Link className="text-teal-ink underline underline-offset-2" href="/workspace">
            Open the case queue
          </Link>
          {me.permissions.includes('csat:followup') && (
            <Link
              className="text-teal-ink underline underline-offset-2"
              href="/workspace/low-ratings"
            >
              Call back low ratings
            </Link>
          )}
        </p>
      </section>

      <MonthBars months={d.months} />

      <div className="grid gap-10 md:grid-cols-2">
        <MonthLine
          title="SLA targets met"
          note="for cases opened that month"
          months={d.months.map((m) => ({ month: m.month, value: m.slaMetPct }))}
          min={0}
          max={100}
          ticks={[0, 25, 50, 75, 100]}
          unit="percent"
        />
        <MonthLine
          title="Satisfaction"
          note="average rating out of 5"
          months={d.months.map((m) => ({
            month: m.month,
            value: m.csatAverage,
            note: `${m.csatResponses} rating${m.csatResponses === 1 ? '' : 's'}`,
          }))}
          min={1}
          max={5}
          ticks={[1, 2, 3, 4, 5]}
          unit="score"
        />
      </div>

      <div className="grid gap-10 md:grid-cols-2">
        <Bars
          title="Cases by product family, last 90 days"
          items={d.byFamily}
          empty="No cases in the last 90 days."
        />
        <Bars
          title="Busiest customers, last 90 days"
          items={d.topCustomers}
          empty="No cases in the last 90 days."
        />
      </div>

      <section aria-labelledby="eng" className="space-y-3">
        <h2 id="eng" className="text-sm font-semibold">
          Engineers
        </h2>
        {d.engineers.length === 0 ? (
          <p className="text-sm text-muted">No engineers have signed in yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Engineer</th>
                  <th className="py-2 pr-4 text-right font-medium">Open cases</th>
                  <th className="py-2 pr-4 text-right font-medium">Resolved this month</th>
                  <th className="py-2 text-right font-medium">Satisfaction, 90 days</th>
                </tr>
              </thead>
              <tbody>
                {d.engineers.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className="py-2 pr-4">{e.name}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{e.open}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{e.resolvedThisMonth}</td>
                    <td className="py-2 text-right tabular-nums">
                      {e.csatAverage === null ? '—' : `${e.csatAverage.toFixed(1)} / 5`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
