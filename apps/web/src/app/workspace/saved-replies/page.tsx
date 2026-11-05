import { notFound } from 'next/navigation';
import type { Me, SavedReply } from '@wd/contracts';
import { api } from '@/lib/api';
import { SavedRepliesManager } from './manager';

export const metadata = { title: 'Saved replies' };

export default async function SavedRepliesPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.isInternal || !me.permissions.includes('case:note:internal')) notFound();
  const r = await api<{ items: SavedReply[] }>('/api/v1/saved-replies');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Saved replies</h1>
        <p className="mt-1 max-w-prose text-muted">
          Text you send often, ready to drop into a case reply. Your own replies are private to you.
          Shared replies are kept by support managers for every engineer.
        </p>
      </div>
      <SavedRepliesManager
        initial={r.items}
        canShare={me.permissions.includes('reply:template:share')}
      />
    </div>
  );
}
