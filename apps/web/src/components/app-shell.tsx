import type { ReactNode } from 'react';
import { Notice } from '@wd/ui';
import type { MeResult } from '@/lib/me';
import { SiteFooter, SiteHeader } from './site-chrome';

export async function AppShell({
  result,
  area,
  children,
}: {
  result: MeResult;
  area: 'portal' | 'workspace' | 'admin';
  children: ReactNode;
}) {
  if ('blocked' in result) {
    return (
      <>
        <SiteHeader />
        <main id="main" className="mx-auto max-w-xl px-4 py-16">
          <Notice tone="warning" title="You can't use the support portal yet">
            {result.blocked}
          </Notice>
        </main>
      </>
    );
  }
  return (
    <>
      <SiteHeader me={result.me} area={area} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
