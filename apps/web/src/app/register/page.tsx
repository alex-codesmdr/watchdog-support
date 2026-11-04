import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { RegisterForm } from './register-form';

export const metadata = { title: 'Register your organisation' };

export default function RegisterPage() {
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
        <RegisterForm />
      </main>
      <SiteFooter />
    </>
  );
}
