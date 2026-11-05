import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { portalSettings } from '@/lib/settings';
import { RegisterForm } from './register-form';

export const metadata = { title: 'Register your organisation' };

export default async function RegisterPage() {
  const cfg = await portalSettings();
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto grid max-w-5xl gap-10 px-4 py-12 md:grid-cols-[1fr_1.3fr]">
        <div>
          <h1 className="text-2xl font-semibold">Register your organisation</h1>
          <p className="mt-3 text-muted">
            One registration per organisation. You become its administrator and can invite
            colleagues once we approve it.
          </p>
          <ol className="mt-6 space-y-3 text-sm">
            <li>
              <span className="font-semibold">1. Submit this form.</span> Use your work email: we
              verify the domain.
            </li>
            <li>
              <span className="font-semibold">2. We review it</span>, usually within one business
              day.
            </li>
            <li>
              <span className="font-semibold">3. Set up sign-in.</span> You choose a password and
              enrol an authenticator app.
            </li>
          </ol>
        </div>
        {cfg.selfRegistration ? (
          <RegisterForm />
        ) : (
          <div className="self-start rounded-m border border-line bg-surface p-5">
            <h2 className="font-semibold">New registrations are closed</h2>
            <p className="mt-2 text-muted">
              To get access for your organisation, write to{' '}
              <span className="font-medium text-ink">{cfg.supportEmail}</span> or contact your
              WatchDog account manager.
            </p>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
