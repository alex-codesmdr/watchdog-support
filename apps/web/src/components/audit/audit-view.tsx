import Link from 'next/link';
import type { AuditPage } from '@wd/contracts';
import { EmptyState } from '@wd/ui';
import { VerifyChain } from './verify-chain';

/** Plain-language names for recorded actions; unknown codes are shown as they are. */
const ACTION: Record<string, string> = {
  'case.create': 'Opened a case',
  'case.transition': 'Changed case status',
  'case.assign': 'Assigned a case',
  'case.escalate': 'Escalated a case',
  'case.csat': 'Rated a case',
  'case.message': 'Replied on a case',
  'rma.create': 'Requested a replacement',
  'rma.transition': 'Updated a replacement',
  'renewal.request': 'Asked for a renewal quote',
  'site.create': 'Added a site',
  'site.update': 'Changed a site',
  'site.delete': 'Removed a site',
  'asset.move': 'Moved a device',
  'asset.import': 'Imported devices',
  download: 'Downloaded a file',
  'eula.accept': 'Accepted a licence',
  'api_key.create': 'Created an API key',
  'api_key.revoke': 'Revoked an API key',
  'webhook.create': 'Added a webhook',
  'webhook.delete': 'Deleted a webhook',
  'webhook.rotate': 'Changed a webhook secret',
  'webhook.enable': 'Turned a webhook on',
  'webhook.disable': 'Turned a webhook off',
  'registration.approve': 'Approved a registration',
  'registration.reject': 'Declined a registration',
  'kb.create': 'Drafted an article',
  'kb.edit': 'Edited an article',
  'kb.publish': 'Published an article',
  'advisory.create': 'Drafted an advisory',
  'advisory.update': 'Revised an advisory',
  'advisory.publish': 'Published an advisory',
  'advisory.withdraw': 'Withdrew an advisory',
  'release.create': 'Created a release',
  'release.update': 'Edited a release',
  'release.file.add': 'Uploaded a release file',
  'release.published': 'Published a release',
  'release.deprecated': 'Superseded a release',
  'release.withdrawn': 'Withdrew a release',
};
const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(iso));

export function AuditView({
  page,
  staff,
  sp,
  orgs,
  title,
  lead,
}: {
  page: AuditPage;
  staff: boolean;
  sp: Record<string, string | undefined>;
  orgs?: { id: string; name: string }[];
  title: string;
  lead: string;
}) {
  const keep = new URLSearchParams(
    Object.entries(sp).filter((e): e is [string, string] => !!e[1] && e[0] !== 'before'),
  );
  const older = page.nextBefore
    ? `?${new URLSearchParams({ ...Object.fromEntries(keep), before: String(page.nextBefore) })}`
    : null;
  const input = 'h-10 rounded-s border border-line bg-surface px-3 font-normal';
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-1 max-w-prose text-muted">{lead}</p>
        </div>
        {staff && <VerifyChain />}
      </div>

      <form className="flex flex-wrap items-end gap-3" aria-label="Filter the log">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          From
          <input type="date" name="from" defaultValue={sp.from} className={input} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          To
          <input type="date" name="to" defaultValue={sp.to} className={input} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Person (name or email)
          <input name="actor" defaultValue={sp.actor} className={input} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Activity
          <select name="action" defaultValue={sp.action ?? ''} className={input}>
            <option value="">Everything</option>
            <option value="case.">Cases</option>
            <option value="rma.">Replacements</option>
            <option value="download">Downloads</option>
            <option value="site.">Sites</option>
            <option value="asset.">Devices</option>
            <option value="api_key.">API keys</option>
            <option value="webhook.">Webhooks</option>
            {staff && <option value="registration.">Registrations</option>}
            {staff && <option value="kb.">Knowledge base</option>}
            {staff && <option value="advisory.">Advisories</option>}
            {staff && <option value="release.">Releases</option>}
          </select>
        </label>
        {orgs && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Organisation
            <select name="orgId" defaultValue={sp.orgId ?? ''} className={input}>
              <option value="">All</option>
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
          className="h-10 rounded-s bg-navy px-4 text-sm font-semibold text-white hover:bg-navy-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Show entries
        </button>
        <a
          href={`/api/v1/audit-log/export.csv?${keep}`}
          className="inline-flex h-10 items-center text-sm font-medium text-teal-ink underline underline-offset-2"
        >
          Download (CSV)
        </a>
      </form>

      {page.items.length === 0 ? (
        <EmptyState title="Nothing recorded for these filters">
          Widen the dates or clear a filter.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={title}>
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">When (IST)</th>
                {staff && <th className="py-2 pr-4 font-medium">Organisation</th>}
                <th className="py-2 pr-4 font-medium">Who</th>
                <th className="py-2 pr-4 font-medium">What</th>
                <th className="py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {page.items.map((e) => (
                <tr key={e.seq}>
                  <td className="py-2 pr-4 whitespace-nowrap tabular-nums">{fmt(e.at)}</td>
                  {staff && <td className="py-2 pr-4">{e.orgName ?? '—'}</td>}
                  <td className="py-2 pr-4">
                    {e.actor}
                    {e.actorEmail && (
                      <span className="block text-xs text-muted">{e.actorEmail}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {ACTION[e.action] ?? e.action}
                    {e.targetType && (
                      <span className="block font-mono text-xs text-muted">
                        {e.targetType} {e.targetId?.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    {e.diff && Object.keys(e.diff).length > 0 ? (
                      <details>
                        <summary className="cursor-pointer text-teal-ink">Show</summary>
                        <pre
                          tabIndex={0}
                          className="mt-1 max-w-md overflow-x-auto rounded-s bg-paper p-2 text-xs"
                        >
                          {JSON.stringify(e.diff, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    {e.ip && <span className="block text-xs text-muted">from {e.ip}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex gap-4 text-sm">
        {sp.before && (
          <Link href={`?${keep}`} className="text-teal-ink underline underline-offset-2">
            Newest entries
          </Link>
        )}
        {older && (
          <Link href={older} className="text-teal-ink underline underline-offset-2">
            Older entries
          </Link>
        )}
      </div>
    </div>
  );
}
