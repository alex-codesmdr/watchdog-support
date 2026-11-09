import {
  COMPONENT_STATUS_LABELS,
  INCIDENT_STATUS_LABELS,
  type ComponentStatus,
  type StatusIncidentView,
  type StatusPage,
} from '@wd/contracts';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { api, currentUser } from '@/lib/api';

/** Server-safe helpers (the design system's helpers run in the browser only). */
const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const fmtIst = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

export const metadata = {
  title: 'Service status',
  description:
    'Whether WatchDog Support services are working normally, and updates on any incident.',
};
export const dynamic = 'force-dynamic';

const TONE: Record<ComponentStatus, { dot: string; band: string; headline: string }> = {
  operational: {
    dot: 'bg-ok',
    band: 'border-ok/40 bg-ok/10',
    headline: 'All services are working normally',
  },
  maintenance: {
    dot: 'bg-navy',
    band: 'border-navy/30 bg-navy/5',
    headline: 'Planned maintenance is in progress',
  },
  degraded: {
    dot: 'bg-amber',
    band: 'border-amber/50 bg-amber/10',
    headline: 'Some services are slower than usual',
  },
  partial_outage: {
    dot: 'bg-amber',
    band: 'border-amber/50 bg-amber/10',
    headline: 'Some services are partly unavailable',
  },
  major_outage: {
    dot: 'bg-danger',
    band: 'border-danger/50 bg-danger/10',
    headline: 'A service is unavailable',
  },
};

function Incident({ i, names }: { i: StatusIncidentView; names: Map<string, string> }) {
  return (
    <article className="rounded-m border border-line bg-surface p-4">
      <h3 className="font-semibold">{i.title}</h3>
      <p className="text-sm text-muted">
        Affects {i.componentIds.map((c) => names.get(c) ?? 'a service').join(', ')}. Started{' '}
        {fmtIst(i.startedAt)}
        {i.resolvedAt ? `, closed ${fmtIst(i.resolvedAt)}` : ''}.
      </p>
      <ol className="mt-3 space-y-3 border-l border-line pl-4">
        {i.updates.map((u) => (
          <li key={u.at}>
            <p className="text-sm">
              <span className="font-semibold">{INCIDENT_STATUS_LABELS[u.status]}</span>{' '}
              <span className="text-muted">{fmtIst(u.at)} IST</span>
            </p>
            <p className="whitespace-pre-line">{u.body}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}

export default async function StatusPageView() {
  const [s, me] = await Promise.all([
    api<StatusPage>('/api/v1/public/status', { optionalAuth: true }),
    currentUser(),
  ]);
  const names = new Map(s.components.map((c) => [c.id, c.name]));
  const tone = TONE[s.overall];
  return (
    <>
      <SiteHeader me={me} />
      <main id="main" className="mx-auto max-w-3xl space-y-8 px-4 py-10">
        <div>
          <h1 className="text-2xl font-semibold">Service status</h1>
          <p className="mt-1 text-muted">
            Last updated {fmtIst(s.updatedAt)} IST. Reload the page for the latest.
          </p>
        </div>
        <p
          className={cn(
            'flex items-center gap-3 rounded-m border px-4 py-3 font-semibold',
            tone.band,
          )}
          role="status"
        >
          <span className={cn('size-3 shrink-0 rounded-full', tone.dot)} aria-hidden="true" />
          {tone.headline}
        </p>
        {s.active.length > 0 && (
          <section aria-labelledby="now" className="space-y-3">
            <h2 id="now" className="text-lg font-semibold">
              Happening now
            </h2>
            {s.active.map((i) => (
              <Incident key={i.id} i={i} names={names} />
            ))}
          </section>
        )}
        <section aria-labelledby="svc">
          <h2 id="svc" className="text-lg font-semibold">
            Services
          </h2>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {s.components.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="min-w-0">
                  <span className="font-medium">{c.name}</span>
                  <span className="block text-sm text-muted">{c.description}</span>
                </span>
                <span className="flex items-center gap-2 text-sm">
                  <span
                    className={cn('size-2.5 rounded-full', TONE[c.status].dot)}
                    aria-hidden="true"
                  />
                  {COMPONENT_STATUS_LABELS[c.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="past" className="space-y-3">
          <h2 id="past" className="text-lg font-semibold">
            Past 30 days
          </h2>
          {s.recent.length ? (
            s.recent.map((i) => <Incident key={i.id} i={i} names={names} />)
          ) : (
            <p className="text-muted">No incidents in the past 30 days.</p>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
