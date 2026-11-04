import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { CsatForm } from './csat-form';

export const metadata = { title: 'Rate your support', robots: { index: false } };

export default async function CsatPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-2xl font-semibold">How did we do?</h1>
        <p className="mt-2 text-muted">
          Your rating goes to the support manager responsible for your case.
        </p>
        <CsatForm token={token ?? ''} />
      </main>
      <SiteFooter />
    </>
  );
}
