import { notFound } from 'next/navigation';
import type { AnnouncementAdmin, Me } from '@wd/contracts';
import { api } from '@/lib/api';
import { AnnouncementsManager } from './manager';

export const metadata = { title: 'Announcements' };

export default async function AnnouncementsPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('announcement:manage')) notFound();
  const r = await api<{ items: AnnouncementAdmin[] }>('/api/v1/admin/announcements');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Announcements</h1>
        <p className="mt-1 max-w-prose text-muted">
          Banners shown at the top of every page. Use them for planned maintenance, service
          incidents and important notices. Up to three show at once, incidents first.
        </p>
      </div>
      <AnnouncementsManager initial={r.items} />
    </div>
  );
}
