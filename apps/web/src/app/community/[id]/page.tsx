import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ForumQuestionView, Me } from '@wd/contracts';
import { api, ApiError } from '@/lib/api';
import { Thread } from './thread';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return { title: 'Community' };
  try {
    return { title: (await api<ForumQuestionView>(`/api/v1/community/${id}`)).title };
  } catch {
    return { title: 'Community' };
  }
}

export default async function QuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('community:post')) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let q: ForumQuestionView;
  try {
    q = await api<ForumQuestionView>(`/api/v1/community/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm">
        <Link className="text-teal-ink underline underline-offset-2" href="/community">
          All questions
        </Link>
      </p>
      <Thread initial={q} />
    </div>
  );
}
