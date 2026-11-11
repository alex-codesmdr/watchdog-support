import { notFound } from 'next/navigation';
import type { IdeaView, Me } from '@wd/contracts';
import { IdeaBoard } from '@/components/ideas/board';
import { api } from '@/lib/api';

export const metadata = { title: 'Suggestions' };
export const dynamic = 'force-dynamic';

export default async function IdeasPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('idea:submit')) notFound();
  const [r, fam] = await Promise.all([
    api<{ items: IdeaView[] }>('/api/v1/ideas'),
    api<{ items: { key: string; name: string }[] }>('/api/v1/catalog/families'),
  ]);
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Suggestions</h1>
        <p className="mt-1 text-muted">
          Tell us what would make WatchDog products and support work better for you, and vote for
          other customers&apos; ideas. Our product team reads every one and replies here.
        </p>
      </div>
      <IdeaBoard initial={r.items} canPost canManage={false} families={fam.items} />
    </div>
  );
}
