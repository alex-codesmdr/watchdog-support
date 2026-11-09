import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: { default: 'WatchDog Support', template: '%s | WatchDog Support' },
  description:
    'Technical support for WatchDog networking, security, wireless and server products: cases, knowledge base, firmware and advisories.',
  robots: { index: true, follow: true },
};
export const viewport: Viewport = { themeColor: '#0B2545', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Chosen theme is rendered on the server so the page never flashes the wrong colours.
  const t = (await cookies()).get('wd-theme')?.value;
  return (
    <html lang="en-IN" data-theme={t === 'light' || t === 'dark' ? t : undefined}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
