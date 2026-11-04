import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { WarrantyCheck } from './warranty-check';

export const metadata = { title: 'Check warranty' };

export default function WarrantyPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-semibold">Check warranty and support coverage</h1>
        <p className="mt-2 text-muted">
          Enter the serial number from the label on the device, or from the{' '}
          <code className="font-mono text-ink">display device manuinfo</code> command.
        </p>
        <WarrantyCheck />
        <p className="mt-10 text-sm text-muted">
          Only coverage is shown here. Signed-in customers see full contract details for every
          registered device on their dashboard.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
