import Link from 'next/link';
import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from './site-chrome';

/** Honest placeholder for areas scheduled in later phases: says what exists today and where to go. */
export async function LaterPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <div className="mt-4 space-y-4 text-muted">{children}</div>
        <p className="mt-8">
          <Link
            href="/portal/cases/new"
            className="font-semibold text-teal-ink underline underline-offset-2"
          >
            Open a case
          </Link>
          <span className="text-muted"> and an engineer will help directly.</span>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
