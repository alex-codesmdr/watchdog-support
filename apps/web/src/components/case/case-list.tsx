'use client';
import Link from 'next/link';
import { STATUS_LABELS, OPEN_STATUSES, type CaseSummary } from '@wd/contracts';
import { SeverityBadge, SlaBar, StatusPill } from '@wd/ui';
import { useT } from '@/components/locale';

const METRIC: Record<string, string> = {
  first_response: 'First response',
  update: 'Next update',
  restoration: 'Restore service',
  resolution: 'Resolution',
};
const rel = (iso: string, tr: (s: string, v?: Record<string, number>) => string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return tr('{n} min ago', { n: Math.max(m, 1) });
  if (m < 1440) return tr('{n} h ago', { n: Math.round(m / 60) });
  return tr('{n} d ago', { n: Math.round(m / 1440) });
};

export function CaseList({
  items,
  base,
  showOrg,
  selectable,
}: {
  items: CaseSummary[];
  base: '/portal/cases' | '/workspace/cases';
  showOrg?: boolean;
  /** Adds a checkbox per row (named "case"); a client wrapper reads them. */
  selectable?: boolean;
}) {
  const tr = useT();
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-m border border-line bg-surface">
      {items.map((c) => (
        <li key={c.id} className={selectable ? 'flex items-stretch' : undefined}>
          {selectable && (
            <label className="flex items-center border-r border-line px-3 hover:bg-paper">
              <input type="checkbox" name="case" value={c.number} className="size-4" />
              <span className="sr-only">{tr('Select {n}', { n: c.number })}</span>
            </label>
          )}
          <Link
            href={`${base}/${c.number}`}
            className="grid min-w-0 flex-1 gap-3 px-4 py-4 hover:bg-paper md:grid-cols-[7.5rem_1fr_14rem] md:items-center"
          >
            <div className="flex items-center gap-2 md:flex-col md:items-start">
              <span className="font-mono text-sm text-muted">{c.number}</span>
              <SeverityBadge severity={c.severity} compact />
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{c.subject}</p>
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                <StatusPill
                  label={tr(STATUS_LABELS[c.status])}
                  open={OPEN_STATUSES.includes(c.status)}
                />
                {showOrg && <span>{c.orgName}</span>}
                {c.modelName && <span>{c.modelName}</span>}
                <span>
                  {c.assigneeName
                    ? tr('Engineer: {name}', { name: c.assigneeName })
                    : tr('Not yet assigned')}
                </span>
                <span>{tr('Updated {when}', { when: rel(c.updatedAt, tr) })}</span>
              </p>
            </div>
            <div>
              {c.nextSla ? (
                <SlaBar
                  label={tr(METRIC[c.nextSla.metric] ?? c.nextSla.metric)}
                  percent={c.nextSla.percentElapsed}
                  remainingSeconds={c.nextSla.remainingSeconds}
                  met={!!c.nextSla.metAt}
                  paused={c.nextSla.paused}
                  dueAt={c.nextSla.dueAt}
                />
              ) : (
                <span className="text-sm text-muted">{tr('No running SLA')}</span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
export { METRIC };
