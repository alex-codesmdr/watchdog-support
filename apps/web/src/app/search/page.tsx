import Link from 'next/link';
import { LaterPage } from '@/components/later';

export const metadata = { title: 'Search' };

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? '').slice(0, 200);
  return (
    <LaterPage title={query ? `Results for “${query}”` : 'Knowledge base'}>
      <p>
        The searchable knowledge base, release notes and resolved-case search are being loaded into
        the portal and will be available here shortly.
      </p>
      {query && (
        <p>
          You can still get help with this now:{' '}
          <Link
            className="font-semibold text-teal-ink underline underline-offset-2"
            href={`/portal/cases/new?subject=${encodeURIComponent(query)}`}
          >
            open a case with this text as the subject
          </Link>
          .
        </p>
      )}
    </LaterPage>
  );
}
