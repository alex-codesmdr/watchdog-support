'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { ImportReport } from '@wd/contracts';
import { Button, Notice } from '@wd/ui';
import { getCsrf } from '@/lib/client';

const MAX = 5 * 1024 * 1024;

async function send(file: File, dryRun: boolean): Promise<ImportReport> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': /\.xlsx$/i.test(file.name)
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv',
  };
  const csrf = await getCsrf();
  if (csrf) headers['x-wd-csrf'] = csrf;
  const r = await fetch(
    `/api/v1/admin/asset-imports?dryRun=${dryRun}&fileName=${encodeURIComponent(file.name)}`,
    { method: 'POST', headers, body: file, cache: 'no-store' },
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail ?? j.title ?? 'The file could not be imported');
  return j as ImportReport;
}

export function Importer() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(dryRun ? 'check' : 'import');
    setErr(null);
    try {
      const r = await send(file, dryRun);
      setReport(r);
      if (!dryRun) router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const pick = (f: File | null) => {
    setReport(null);
    setErr(null);
    if (f && f.size > MAX) {
      setErr('The file is larger than 5 MB. Split it into smaller files.');
      setFile(null);
      return;
    }
    setFile(f);
  };
  const problems = report?.rows.filter((r) => r.status === 'error' || r.row === 1) ?? [];
  const willChange = report ? report.created + report.updated : 0;

  return (
    <section aria-labelledby="up" className="space-y-5">
      <h2 id="up" className="sr-only">
        Upload a file
      </h2>
      <ol className="grid gap-5 md:grid-cols-3">
        <li className="rounded-m border border-line p-4">
          <p className="font-semibold">1. Fill in the template</p>
          <p className="mt-1 text-sm text-muted">
            One row per device. Coverage columns are optional; dates can be 2026-01-31 or
            31/01/2026.
          </p>
          <a
            href="/api/v1/admin/asset-imports/template.csv"
            className="mt-3 inline-flex text-sm font-medium text-teal-ink underline underline-offset-2"
          >
            Download template (CSV)
          </a>
        </li>
        <li className="rounded-m border border-line p-4">
          <p className="font-semibold">2. Check the file</p>
          <p className="mt-1 text-sm text-muted">CSV or Excel (.xlsx), up to 5,000 devices.</p>
          <label className="mt-3 block text-sm font-medium" htmlFor="import-file">
            Spreadsheet
          </label>
          <input
            ref={input}
            id="import-file"
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm file:mr-3 file:h-9 file:rounded-s file:border file:border-line file:bg-surface file:px-3 file:text-ink"
          />
          <Button
            className="mt-3"
            size="sm"
            disabled={!file}
            busy={busy === 'check'}
            onClick={() => run(true)}
          >
            Check file
          </Button>
        </li>
        <li className="rounded-m border border-line p-4">
          <p className="font-semibold">3. Import</p>
          <p className="mt-1 text-sm text-muted">
            Rows with problems are skipped; fix them and upload the file again.
          </p>
          <Button
            className="mt-3"
            size="sm"
            disabled={!report?.dryRun || willChange === 0}
            busy={busy === 'import'}
            onClick={() => run(false)}
          >
            {report?.dryRun && willChange > 0
              ? `Import ${willChange} ${willChange === 1 ? 'device' : 'devices'}`
              : 'Import'}
          </Button>
        </li>
      </ol>

      {err && <Notice tone="error">{err}</Notice>}
      {report && (
        <div className="space-y-4" aria-live="polite">
          <Notice
            tone={report.failed ? 'warning' : 'success'}
            title={
              report.dryRun
                ? `Check complete: ${report.totalRows} rows in ${report.fileName}`
                : `Imported ${report.fileName}`
            }
          >
            {report.dryRun ? 'Will add' : 'Added'} {report.created},{' '}
            {report.dryRun ? 'will update' : 'updated'} {report.updated}, unchanged{' '}
            {report.unchanged}, rejected {report.failed}.
          </Notice>
          {problems.length > 0 && (
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Rows with problems"
            >
              <table className="w-full min-w-[32rem] text-left text-sm">
                <caption className="pb-2 text-left font-semibold">Rows to fix</caption>
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Row</th>
                    <th className="py-2 pr-4 font-medium">Serial</th>
                    <th className="py-2 font-medium">Problem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {problems.slice(0, 200).map((r) => (
                    <tr key={`${r.row}-${r.serialNumber}`}>
                      <td className="py-2 pr-4 tabular-nums">{r.row}</td>
                      <td className="py-2 pr-4 font-mono">{r.serialNumber ?? '—'}</td>
                      <td className="py-2">{r.messages.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {problems.length > 200 && (
                <p className="mt-2 text-sm text-muted">
                  Showing the first 200 of {problems.length} rows with problems.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
