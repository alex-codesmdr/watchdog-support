import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ForumQuestionSummary, Me } from '@wd/contracts';
import { EmptyState } from '@wd/ui';
import { api } from '@/lib/api';
import { AskForm } from './ask-form';

export const metadata = { title: 'Community' };
export const dynamic = 'force-dynamic';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('community:post')) notFound();
  const sp = await searchParams;
  const q = (sp.q ?? '').slice(0, 120);
  const show = sp.show === 'unanswered' ? 'unanswered' : '';
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(show ? { show } : {}) });
  const [r, fam] = await Promise.all([
    api<{ items: ForumQuestionSummary[] }>(`/api/v1/community?${qs}`),
    api<{ items: { key: string; name: string }[] }>('/api/v1/catalog/families'),
  ]);
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Community</h1>
          <p className="mt-1 max-w-prose text-muted">
            Questions and answers from WatchDog customers and engineers. People appear by first name
            and initial; organisations are never shown. For anything urgent, or about your own
            devices, open a case instead.
          </p>
        </div>
        <form className="flex flex-wrap items-end gap-3" role="search">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium">
            Search questions
            <input
              name="q"
              defaultValue={q}
              className="h-10 rounded-s border border-line bg-surface px-3 font-normal"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Show
            <select
              name="show"
              defaultValue={show}
              className="h-10 rounded-s border border-line bg-surface px-3 font-normal"
            >
              <option value="">All questions</option>
              <option value="unanswered">Not answered yet</option>
            </select>
          </label>
          <button
            type="submit"
            className="h-10 rounded-s bg-navy px-4 text-sm font-semibold text-white hover:bg-navy-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus dark:bg-teal dark:text-navy"
          >
            Search
          </button>
        </form>
        {r.items.length === 0 ? (
          <EmptyState title={q ? 'No questions match' : 'No questions yet'}>
            {q ? 'Try other words, or ask it yourself.' : 'Ask the first one.'}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {r.items.map((i) => (
              <li key={i.id} className="py-4">
                <Link
                  href={`/community/${i.id}`}
                  className="font-semibold text-teal-ink underline underline-offset-2"
                >
                  {i.title}
                </Link>
                <p className="mt-1 text-sm">{i.excerpt}</p>
                <p className="mt-1 text-sm text-muted">
                  {i.solved
                    ? 'Answered'
                    : i.answers
                      ? `${i.answers} repl${i.answers === 1 ? 'y' : 'ies'}`
                      : 'No replies yet'}
                  {i.familyName ? `. ${i.familyName}` : ''}. Asked by {i.author} on{' '}
                  {fmt(i.createdAt)}
                  {i.hidden ? ' (hidden)' : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <aside>
        <AskForm families={fam.items} />
      </aside>
    </div>
  );
}
