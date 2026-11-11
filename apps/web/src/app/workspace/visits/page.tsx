import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Me, VisitView } from '@wd/contracts';
import { EmptyState } from '@wd/ui';
import { api } from '@/lib/api';

export const metadata = { title: 'Visits' };
export const dynamic = 'force-dynamic';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));

export default async function VisitsPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('visit:manage')) notFound();
  const r = await api<{ items: VisitView[] }>('/api/v1/workspace/visits');
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Visits</h1>
        <p className="mt-1 text-muted">
          Booked engineer visits and remote sessions, soonest first. Customers book them from the
          case page in free slots taken from the roster.
        </p>
      </div>
      {r.items.length === 0 ? (
        <EmptyState title="Nothing booked">
          New bookings appear here and are emailed to the engineer.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">When (IST)</th>
                <th className="py-2 pr-4 font-medium">What</th>
                <th className="py-2 pr-4 font-medium">Customer</th>
                <th className="py-2 pr-4 font-medium">Engineer</th>
                <th className="py-2 font-medium">Contact</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((v) => (
                <tr key={v.id} className="border-t border-line align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">{when(v.startsAt)}</td>
                  <td className="py-2 pr-4">
                    {v.kind === 'onsite' ? 'On site' : 'Remote'},{' '}
                    <Link
                      className="text-teal-ink underline underline-offset-2"
                      href={`/workspace/cases/${v.caseNumber}`}
                    >
                      {v.caseNumber}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    {v.orgName}
                    {v.siteName ? <span className="block text-muted">{v.siteName}</span> : null}
                  </td>
                  <td className="py-2 pr-4">{v.engineerName ?? '—'}</td>
                  <td className="py-2">
                    {v.contactName}
                    <span className="block text-muted">{v.contactPhone}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
