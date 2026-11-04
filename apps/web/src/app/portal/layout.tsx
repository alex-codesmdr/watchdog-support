import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { loadMe } from '@/lib/me';

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const r = await loadMe('/portal');
  if ('me' in r && r.me.isInternal) redirect('/workspace');
  return (
    <AppShell result={r} area="portal">
      {children}
    </AppShell>
  );
}
