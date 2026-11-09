import Link from 'next/link';
import { RMA_STATUS_LABELS, RMA_TYPE_LABELS, type RmaSummary } from '@wd/contracts';
import { EmptyState } from '@wd/ui';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));

/** RMA table shared by the customer portal and the RMA coordinator's workspace. */
export function RmaList({
  items,
  base,
  showOrg,
  status,
}: {
  items: RmaSummary[];
  base: string;
  showOrg: boolean;
  status: 'open' | 'closed';
}) {
  return (
    <div className="space-y-4">
      <nav aria-label="RMA status" className="flex gap-1 text-sm">
        {(['open', 'closed'] as const).map((s) => (
          <Link
            key={s}
            href={`?status=${s}`}
            aria-current={status === s ? 'page' : undefined}
            className={
              status === s
                ? 'rounded-s bg-navy dark:bg-teal dark:text-navy px-3 py-1.5 text-white'
                : 'rounded-s px-3 py-1.5 text-ink hover:bg-navy/5'
            }
          >
            {s === 'open' ? 'In progress' : 'Finished'}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <EmptyState
          title={status === 'open' ? 'No replacements in progress' : 'No finished replacements'}
        >
          Request a replacement from a support case when troubleshooting points to faulty hardware.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="RMAs">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">RMA</th>
                {showOrg && <th className="py-2 pr-4 font-medium">Customer</th>}
                <th className="py-2 pr-4 font-medium">Device</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4">
                    <Link
                      href={`${base}/${r.number}`}
                      className="font-mono text-teal-ink underline underline-offset-2"
                    >
                      {r.number}
                    </Link>
                  </td>
                  {showOrg && <td className="py-2 pr-4">{r.org.name}</td>}
                  <td className="py-2 pr-4">
                    {r.modelName} <span className="font-mono text-muted">{r.serialNumber}</span>
                  </td>
                  <td className="py-2 pr-4">{RMA_TYPE_LABELS[r.type]}</td>
                  <td className="py-2 pr-4">{RMA_STATUS_LABELS[r.status]}</td>
                  <td className="py-2 whitespace-nowrap">{fmt(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
