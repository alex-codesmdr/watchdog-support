import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { loadMe } from '@/lib/me';

export default async function CommunityLayout({ children }: { children: ReactNode }) {
  const r = await loadMe('/community');
  return (
    <AppShell result={r} area={'me' in r && r.me.isInternal ? 'workspace' : 'portal'}>
      {children}
    </AppShell>
  );
}
