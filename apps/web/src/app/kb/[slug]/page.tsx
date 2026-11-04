import Link from 'next/link';
import { notFound } from 'next/navigation';
import { KB_TYPE_LABELS, type KbArticleView } from '@wd/contracts';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { api, ApiError, currentUser } from '@/lib/api';
import { Feedback } from './feedback';

async function load(slug: string) {
  try {
    return await api<KbArticleView>(`/api/v1/kb/articles/${encodeURIComponent(slug)}`, {
      optionalAuth: true,
    });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const a = await load((await params).slug);
  return a ? { title: a.title, description: a.summary } : { title: 'Article not found' };
}

const VIS: Record<string, string> = {
  registered: 'Registered customers',
  partner: 'Partners',
  internal: 'Internal: WatchDog staff only',
};
const date = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));

export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [a, me] = await Promise.all([load(slug), currentUser()]);
  if (!a) notFound();
  return (
    <>
      <SiteHeader me={me} />
      <main id="main" className="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[1fr_17rem]">
        <article className="min-w-0 max-w-3xl">
          <p className="text-sm text-muted">
            <Link href="/search" className="hover:underline">
              Knowledge base
            </Link>{' '}
            / {KB_TYPE_LABELS[a.type]}
            {a.family && (
              <>
                {' '}
                /{' '}
                <Link href={`/search?family=${a.family.key}`} className="hover:underline">
                  {a.family.name}
                </Link>
              </>
            )}
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight">{a.title}</h1>
          <p className="mt-3 text-lg text-muted">{a.summary}</p>
          {a.visibility !== 'public' && (
            <p className="mt-3 inline-block rounded-s bg-amber/15 px-2 py-1 text-sm text-amber-ink">
              Visible to: {VIS[a.visibility]}
            </p>
          )}
          <div
            className="wd-prose wd-article mt-8"
            dangerouslySetInnerHTML={{ __html: a.bodyHtml }}
          />
          <Feedback slug={a.slug} />
        </article>
        <aside className="space-y-6 text-sm">
          <dl className="grid grid-cols-[6.5rem_1fr] gap-y-2">
            <dt className="text-muted">Updated</dt>
            <dd>{a.publishedAt ? date(a.publishedAt) : '—'}</dd>
            <dt className="text-muted">Version</dt>
            <dd>{a.version}</dd>
            {a.products.length > 0 && (
              <>
                <dt className="text-muted">Applies to</dt>
                <dd>{a.products.map((p) => p.modelName).join(', ')}</dd>
              </>
            )}
            {a.firmwareVersions.length > 0 && (
              <>
                <dt className="text-muted">Software</dt>
                <dd className="font-mono">{a.firmwareVersions.join(', ')}</dd>
              </>
            )}
          </dl>
          {a.related.length > 0 && (
            <section aria-labelledby="rel">
              <h2 id="rel" className="font-semibold">
                Related articles
              </h2>
              <ul className="mt-2 space-y-2">
                {a.related.map((r) => (
                  <li key={r.slug}>
                    <Link
                      href={`/kb/${r.slug}`}
                      className="text-teal-ink underline underline-offset-2"
                    >
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-muted">
            Still stuck?{' '}
            <Link
              href={`/portal/cases/new?subject=${encodeURIComponent(a.title)}`}
              className="font-semibold text-teal-ink underline underline-offset-2"
            >
              Open a case
            </Link>
          </p>
        </aside>
      </main>
      <SiteFooter />
    </>
  );
}
