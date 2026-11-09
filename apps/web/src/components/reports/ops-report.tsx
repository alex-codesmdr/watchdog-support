import Link from 'next/link';
import type { OpsReport } from '@wd/contracts';
import { WeeklyChart } from './weekly-chart';

type Count = OpsReport['bySeverity'][number];

const dur = (min: number | null) =>
  min === null ? '—' : min < 120 ? `${Math.round(min)} min` : `${(min / 60).toFixed(1)} h`;

/** A ranked list where each row's bar is proportional to the largest count (single series). */
function Bars({ title, items, empty }: { title: string; items: Count[]; empty: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {items.every((i) => i.count === 0) ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((i) => (
            <li
              key={i.key}
              className="grid grid-cols-[minmax(0,12rem)_1fr_2.5rem] items-center gap-3"
            >
              <span className="truncate" title={i.label}>
                {i.label}
              </span>
              <span className="h-2.5 rounded-r-[4px] bg-line/60" aria-hidden="true">
                {i.count > 0 && (
                  <span
                    className="block h-full rounded-r-[4px] bg-chart-1"
                    style={{ width: `${Math.max(2, (i.count / max) * 100)}%` }}
                  />
                )}
              </span>
              <span className="text-right tabular-nums">{i.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-l-2 border-line pl-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {note && <dd className="text-xs text-muted">{note}</dd>}
    </div>
  );
}

const fmtDay = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${d}T00:00:00`),
  );

/** Operations report shared by the customer portal (own organisation) and the manager workspace. */
export function OpsReportView({
  r,
  orgs,
  basePath,
}: {
  r: OpsReport;
  orgs?: { id: string; name: string }[];
  basePath: string;
}) {
  const qs = new URLSearchParams({
    from: r.from,
    to: r.to,
    ...(r.scope.orgId && orgs ? { orgId: r.scope.orgId } : {}),
  });
  const t = r.totals;
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Support report</h1>
        <p className="mt-1 text-muted">
          {r.scope.orgName ?? 'All customers'}, cases opened {fmtDay(r.from)} to {fmtDay(r.to)}{' '}
          (IST).
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" aria-label="Report period">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          From
          <input
            type="date"
            name="from"
            defaultValue={r.from}
            className="h-10 rounded-s border border-line bg-surface px-3 font-normal"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          To
          <input
            type="date"
            name="to"
            defaultValue={r.to}
            className="h-10 rounded-s border border-line bg-surface px-3 font-normal"
          />
        </label>
        {orgs && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Customer
            <select
              name="orgId"
              defaultValue={r.scope.orgId ?? ''}
              className="h-10 rounded-s border border-line bg-surface px-3 font-normal"
            >
              <option value="">All customers</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="submit"
          className="h-10 rounded-s bg-navy dark:bg-teal dark:text-navy px-4 text-sm font-semibold text-white hover:bg-navy-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Update report
        </button>
        <a
          href={`/api/v1/reports/operations/cases.csv?${qs}`}
          className="inline-flex h-10 items-center text-sm font-medium text-teal-ink underline underline-offset-2"
        >
          Download cases (CSV)
        </a>
        <Link
          href={basePath}
          className="inline-flex h-10 items-center text-sm text-muted underline underline-offset-2"
        >
          Last 90 days
        </Link>
      </form>

      <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Tile label="Cases opened" value={String(t.opened)} />
        <Tile label="Cases resolved" value={String(t.resolved)} />
        <Tile label="Open now" value={String(t.openNow)} note="all dates" />
        <Tile label="Replacements (RMA)" value={String(t.rmasOpened)} />
        <Tile label="Median first response" value={dur(t.medianFirstResponseMinutes)} />
        <Tile
          label="Median time to resolve"
          value={t.medianResolutionHours === null ? '—' : dur(t.medianResolutionHours * 60)}
        />
        <Tile
          label="Satisfaction"
          value={t.csatAverage === null ? '—' : `${t.csatAverage.toFixed(1)} / 5`}
          note={`${t.csatResponses} response${t.csatResponses === 1 ? '' : 's'}`}
        />
      </dl>

      <WeeklyChart weeks={r.weekly} />

      <div className="grid gap-10 md:grid-cols-2">
        <Bars title="By severity" items={r.bySeverity} empty="No cases in this period." />
        <Bars title="Open cases by age" items={r.backlogAge} empty="No open cases." />
        <Bars title="By product family" items={r.byFamily} empty="No cases in this period." />
        <Bars title="By category" items={r.byCategory} empty="No cases in this period." />
        {!r.scope.orgId && r.topOrganisations.length > 0 && (
          <Bars title="Busiest customers" items={r.topOrganisations} empty="" />
        )}
      </div>
    </div>
  );
}
