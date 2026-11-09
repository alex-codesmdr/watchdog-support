import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { currentUser } from '@/lib/api';
import { Assistant } from './assistant';

export const metadata = {
  title: 'Ask WatchDog Support',
  description: 'Ask a question in your own words and get an answer from WatchDog support articles.',
};

export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [me, sp] = await Promise.all([currentUser(), searchParams]);
  return (
    <>
      <SiteHeader me={me} />
      <main id="main" className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        <div>
          <h1 className="text-2xl font-semibold">Ask WatchDog Support</h1>
          <p className="mt-1 text-muted">
            Describe the problem in your own words. Answers come only from WatchDog support articles
            {me ? ' you can read' : ''}, with links so you can check the full steps.
          </p>
        </div>
        <Assistant initial={(sp.q ?? '').slice(0, 500)} signedIn={!!me} />
      </main>
      <SiteFooter />
    </>
  );
}
