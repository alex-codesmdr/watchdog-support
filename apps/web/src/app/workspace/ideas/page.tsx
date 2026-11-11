import { notFound } from 'next/navigation';
import type { IdeaView, Me } from '@wd/contracts';
import { IdeaBoard } from '@/components/ideas/board';
import { api } from '@/lib/api';

export const metadata = { title: 'Customer suggestions' };
export const dynamic = 'force-dynamic';

export default async function StaffIdeasPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('idea:manage')) notFound();
  const r = await api<{ items: IdeaView[] }>('/api/v1/ideas');
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Customer suggestions</h1>
        <p className="mt-1 text-muted">
          Product ideas from customers and partners, with their votes. Set a status and reply so
          customers know where each one stands; hide anything unsuitable.
        </p>
      </div>
      <IdeaBoard initial={r.items} canPost={false} canManage families={[]} />
    </div>
  );
}
