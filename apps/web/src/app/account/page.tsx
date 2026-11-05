import type { Me } from '@wd/contracts';
import { api } from '@/lib/api';
import { AccountForm } from './account-form';

export const metadata = { title: 'My account' };

export default async function AccountPage() {
  const me = await api<Me>('/api/v1/me');
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My account</h1>
        <p className="mt-1 text-muted">
          {me.email}, {me.org.name}
        </p>
      </div>
      <AccountForm me={me} />
      <section aria-labelledby="security" className="space-y-1 border-t border-line pt-6">
        <h2 id="security" className="font-semibold">
          Password and sign-in
        </h2>
        <p className="text-sm text-muted">
          Your password and authenticator app are managed on the WatchDog sign-in page. To change
          them, sign out and choose &quot;Forgot password&quot; when you sign in again.
        </p>
      </section>
    </div>
  );
}
