import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { loadMe } from '@/lib/me';

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const r = await loadMe('/account');
  const area = 'me' in r && r.me.isInternal ? 'workspace' : 'portal';
  return (
    <AppShell result={r} area={area}>
      {children}
    </AppShell>
  );
}
