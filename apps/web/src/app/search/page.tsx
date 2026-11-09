import Link from 'next/link';
import { KB_TYPE_LABELS, type KbSearchResult, type KbType } from '@wd/contracts';
import { EmptyState } from '@wd/ui';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { api, currentUser } from '@/lib/api';

export const metadata = { title: 'Knowledge base' };

const FAMILY: Record<string, string> = {
  'sd-wan': 'SD-WAN',
  switching: 'Switching',
  routing: 'Routing',
  security: 'Security',
  wireless: 'Wireless',
  'servers-storage': 'Servers & Storage',
  management: 'Management',
};

export default async function Search({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; family?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? '').slice(0, 200);
  const qs = new URLSearchParams({
    q,
    page: sp.page ?? '1',
    limit: '10',
    ...(sp.type ? { type: sp.type } : {}),
    ...(sp.family ? { family: sp.family } : {}),
  });
  const [r, me] = await Promise.all([
    api<KbSearchResult>(`/api/v1/kb/search?${qs}`, { optionalAuth: true }),
    currentUser(),
  ]);
  const link = (patch: Record<string, string | undefined>) => {
    const n = new URLSearchParams({
      q,
      ...(sp.type ? { type: sp.type } : {}),
      ...(sp.family ? { family: sp.family } : {}),
    });
    for (const [k, v] of Object.entries(patch)) {
      if (v) n.set(k, v);
      else n.delete(k);
    }
    n.delete('page');
    return `?${n}`;
  };
  const page = Number(sp.page ?? 1);
  return (
    <>
      <SiteHeader me={me} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-10">
        <form role="search" className="flex max-w-3xl gap-2">
          <label htmlFor="kbq" className="sr-only">
            Search the knowledge base
          </label>
          <input
            id="kbq"
            name="q"
            defaultValue={q}
            placeholder="Error message, model or topic"
            className="h-11 min-w-0 flex-1 rounded-s border border-line bg-surface px-3 font-mono text-[0.95rem]"
          />
          {sp.type && <input type="hidden" name="type" value={sp.type} />}
          {sp.family && <input type="hidden" name="family" value={sp.family} />}
          <button className="h-11 rounded-s bg-navy dark:bg-teal dark:text-navy px-5 font-semibold text-white">
            Search
          </button>
        </form>

        <div className="mt-8 grid gap-10 md:grid-cols-[13rem_1fr]">
          <aside aria-label="Filters" className="space-y-6 text-sm">
            <div>
              <h2 className="font-semibold">Article type</h2>
              <ul className="mt-2 space-y-1">
                {Object.entries(KB_TYPE_LABELS).map(([k, label]) => (
                  <li key={k}>
                    <Link
                      href={link({ type: sp.type === k ? undefined : k })}
                      aria-current={sp.type === k ? 'true' : undefined}
                      className="flex justify-between gap-2 rounded-s px-2 py-1 hover:bg-surface aria-[current=true]:bg-navy aria-[current=true]:text-white"
                    >
                      <span>{label}</span>
                      <span className="tabular-nums opacity-70">{r.facets.type[k] ?? 0}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="font-semibold">Product family</h2>
              <ul className="mt-2 space-y-1">
                {Object.entries(FAMILY).map(([k, label]) => (
                  <li key={k}>
                    <Link
                      href={link({ family: sp.family === k ? undefined : k })}
                      aria-current={sp.family === k ? 'true' : undefined}
                      className="flex justify-between gap-2 rounded-s px-2 py-1 hover:bg-surface aria-[current=true]:bg-navy aria-[current=true]:text-white"
                    >
                      <span>{label}</span>
                      <span className="tabular-nums opacity-70">{r.facets.family[k] ?? 0}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <section aria-labelledby="results">
            <h1 id="results" className="text-xl font-semibold">
              {q ? `${r.total} result${r.total === 1 ? '' : 's'} for “${q}”` : 'Knowledge base'}
            </h1>
            {r.didYouMean && (
              <p className="mt-2 text-sm">
                Did you mean{' '}
                <Link
                  className="text-teal-ink underline underline-offset-2"
                  href={`?q=${encodeURIComponent(r.didYouMean)}`}
                >
                  {r.didYouMean}
                </Link>
                ?
              </p>
            )}
            {r.items.length ? (
              <ol className="mt-4 divide-y divide-line">
                {r.items.map((i) => (
                  <li key={i.slug} className="py-4">
                    <p className="text-xs text-muted">
                      {KB_TYPE_LABELS[i.type as KbType]}
                      {i.familyName ? `, ${i.familyName}` : ''}
                    </p>
                    <h2 className="mt-1 text-lg font-semibold">
                      <Link href={`/kb/${i.slug}`} className="hover:underline">
                        {i.title}
                      </Link>
                    </h2>
                    <p
                      className="mt-1 text-muted [&_mark]:bg-teal/20 [&_mark]:text-ink"
                      dangerouslySetInnerHTML={{ __html: i.snippet }}
                    />
                  </li>
                ))}
              </ol>
            ) : (
              <div className="mt-6">
                <EmptyState
                  title="No articles match"
                  action={
                    <Link
                      className="font-semibold text-teal-ink underline underline-offset-2"
                      href={`/portal/cases/new?subject=${encodeURIComponent(q)}`}
                    >
                      Open a case with this text
                    </Link>
                  }
                >
                  Try fewer or different words, an exact error message, or a model number such as
                  SW5600.
                </EmptyState>
              </div>
            )}
            {r.total > page * 10 && (
              <p className="mt-6">
                <Link
                  className="font-medium text-teal-ink underline underline-offset-2"
                  href={`${link({})}&page=${page + 1}`}
                >
                  More results
                </Link>
              </p>
            )}
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
