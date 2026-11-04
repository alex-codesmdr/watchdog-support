import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { loadMe } from '@/lib/me';

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const r = await loadMe('/workspace');
  if ('me' in r && !r.me.isInternal) redirect('/portal');
  return (
    <AppShell result={r} area="workspace">
      {children}
    </AppShell>
  );
}
