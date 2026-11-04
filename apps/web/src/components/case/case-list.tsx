import Link from 'next/link';
import { STATUS_LABELS, OPEN_STATUSES, type CaseSummary } from '@wd/contracts';
import { SeverityBadge, SlaBar, StatusPill } from '@wd/ui';

const METRIC: Record<string, string> = {
  first_response: 'First response',
  update: 'Next update',
  restoration: 'Restore service',
  resolution: 'Resolution',
};
const rel = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

export function CaseList({
  items,
  base,
  showOrg,
}: {
  items: CaseSummary[];
  base: '/portal/cases' | '/workspace/cases';
  showOrg?: boolean;
}) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-m border border-line bg-surface">
      {items.map((c) => (
        <li key={c.id}>
          <Link
            href={`${base}/${c.number}`}
            className="grid gap-3 px-4 py-4 hover:bg-paper md:grid-cols-[7.5rem_1fr_14rem] md:items-center"
          >
            <div className="flex items-center gap-2 md:flex-col md:items-start">
              <span className="font-mono text-sm text-muted">{c.number}</span>
              <SeverityBadge severity={c.severity} compact />
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{c.subject}</p>
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                <StatusPill
                  label={STATUS_LABELS[c.status]}
                  open={OPEN_STATUSES.includes(c.status)}
                />
                {showOrg && <span>{c.orgName}</span>}
                {c.modelName && <span>{c.modelName}</span>}
                <span>{c.assigneeName ? `Engineer: ${c.assigneeName}` : 'Not yet assigned'}</span>
                <span>Updated {rel(c.updatedAt)}</span>
              </p>
            </div>
            <div>
              {c.nextSla ? (
                <SlaBar
                  label={METRIC[c.nextSla.metric] ?? c.nextSla.metric}
                  percent={c.nextSla.percentElapsed}
                  remainingSeconds={c.nextSla.remainingSeconds}
                  met={!!c.nextSla.metAt}
                  paused={c.nextSla.paused}
                  dueAt={c.nextSla.dueAt}
                />
              ) : (
                <span className="text-sm text-muted">No running SLA</span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
export { METRIC };
