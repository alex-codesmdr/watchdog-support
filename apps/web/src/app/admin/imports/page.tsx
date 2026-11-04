import { notFound } from 'next/navigation';
import type { Me } from '@wd/contracts';
import { api } from '@/lib/api';
import { Importer } from './importer';

export const metadata = { title: 'Device import' };

interface ImportRow {
  id: string;
  fileName: string;
  dryRun: boolean;
  totalRows: number;
  created: number;
  updated: number;
  failed: number;
  uploadedBy: string;
  createdAt: string;
}
const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

export default async function ImportsPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('asset:import')) notFound();
  const history = await api<{ items: ImportRow[] }>('/api/v1/admin/asset-imports');
  const real = history.items.filter((h) => !h.dryRun);
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Device import</h1>
        <p className="mt-1 max-w-prose text-muted">
          Register customer devices and their coverage from a spreadsheet. Every file is checked
          first; nothing changes until you confirm. Re-importing the same file is safe.
        </p>
      </div>
      <Importer />
      <section aria-labelledby="hist">
        <h2 id="hist" className="text-lg font-semibold">
          Recent imports
        </h2>
        {real.length ? (
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-labelledby="hist">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">When (IST)</th>
                  <th className="py-2 pr-4 font-medium">File</th>
                  <th className="py-2 pr-4 font-medium">By</th>
                  <th className="py-2 pr-4 text-right font-medium">Added</th>
                  <th className="py-2 pr-4 text-right font-medium">Updated</th>
                  <th className="py-2 text-right font-medium">Rejected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {real.map((h) => (
                  <tr key={h.id}>
                    <td className="py-2 pr-4 whitespace-nowrap">{fmt(h.createdAt)}</td>
                    <td className="py-2 pr-4">{h.fileName}</td>
                    <td className="py-2 pr-4">{h.uploadedBy}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{h.created}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{h.updated}</td>
                    <td
                      className={`py-2 text-right tabular-nums ${h.failed ? 'font-semibold text-danger' : ''}`}
                    >
                      {h.failed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">No imports yet.</p>
        )}
      </section>
    </div>
  );
}
