import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { loadMe } from '@/lib/me';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const r = await loadMe('/admin/registrations');
  if ('me' in r && !r.me.isInternal) notFound();
  return (
    <AppShell result={r} area="admin">
      {children}
    </AppShell>
  );
}
