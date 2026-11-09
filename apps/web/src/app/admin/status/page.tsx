import { notFound } from 'next/navigation';
import type { Me, StatusPage } from '@wd/contracts';
import { api } from '@/lib/api';
import { StatusManager } from './manager';

export const metadata = { title: 'Service status' };

export default async function StatusAdmin() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('status:manage')) notFound();
  const s = await api<StatusPage>('/api/v1/public/status');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Service status</h1>
        <p className="mt-1 max-w-prose text-muted">
          What customers see on the public{' '}
          <a href="/status" className="text-teal-ink underline underline-offset-2">
            status page
          </a>
          . Open an incident when a service is affected and post an update at least every hour until
          it is resolved.
        </p>
      </div>
      <StatusManager initial={s} />
    </div>
  );
}
