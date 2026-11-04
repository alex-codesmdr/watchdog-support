import Link from 'next/link';
import { notFound } from 'next/navigation';
import { KB_TYPE_LABELS, type KbType, type Me } from '@wd/contracts';
import { EmptyState } from '@wd/ui';
import { api } from '@/lib/api';

export const metadata = { title: 'Knowledge base editor' };

interface Row {
  id: string;
  slug: string;
  title: string;
  type: KbType;
  visibility: string;
  state: string;
  currentVersion: number;
  publishedVersion: number | null;
  updatedAt: string;
  authorName: string;
}
const STATES = [
  ['', 'All'],
  ['draft', 'Drafts'],
  ['review', 'In review'],
  ['published', 'Published'],
  ['archived', 'Archived'],
] as const;
const STATE_LABEL: Record<string, string> = {
  draft: 'Draft',
  review: 'In review',
  published: 'Published',
  archived: 'Archived',
};

export default async function KbEditorList({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('kb:draft')) notFound();
  const { state = '' } = await searchParams;
  const { items } = await api<{ items: Row[] }>(
    `/api/v1/kb/editor/articles${state ? `?state=${state}` : ''}`,
  );
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Knowledge base</h1>
        <Link
          href="/workspace/kb/new"
          className="inline-flex h-10 items-center rounded-s bg-navy px-4 text-sm font-semibold text-white hover:bg-navy-2"
        >
          New article
        </Link>
      </div>
      <nav aria-label="Article state" className="mt-4 flex flex-wrap gap-1 border-b border-line">
        {STATES.map(([k, l]) => (
          <Link
            key={k}
            href={k ? `?state=${k}` : '?'}
            aria-current={k === state ? 'page' : undefined}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-ink aria-[current=page]:border-teal aria-[current=page]:font-semibold aria-[current=page]:text-ink"
          >
            {l}
          </Link>
        ))}
      </nav>
      {items.length ? (
        <ul className="mt-4 divide-y divide-line rounded-m border border-line bg-surface">
          {items.map((a) => (
            <li key={a.id}>
              <Link
                href={`/workspace/kb/${a.id}`}
                className="grid gap-1 px-4 py-3 hover:bg-paper md:grid-cols-[1fr_10rem_9rem]"
              >
                <span>
                  <span className="font-medium">{a.title}</span>
                  <span className="block text-sm text-muted">
                    {KB_TYPE_LABELS[a.type]}, {a.visibility}, by {a.authorName}
                  </span>
                </span>
                <span className="text-sm">
                  {STATE_LABEL[a.state]}
                  {a.publishedVersion && a.currentVersion > a.publishedVersion
                    ? ' (unpublished changes)'
                    : ''}
                </span>
                <span className="text-sm text-muted">v{a.currentVersion}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4">
          <EmptyState title="No articles here">
            Write one, or create a draft from a resolved case.
          </EmptyState>
        </div>
      )}
    </div>
  );
}
