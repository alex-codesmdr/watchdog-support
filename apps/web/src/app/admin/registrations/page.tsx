import type { RegistrationSummary } from '@wd/contracts';
import { EmptyState } from '@wd/ui';
import { api } from '@/lib/api';
import { Decide } from './decide';

export const metadata = { title: 'Registrations' };

export default async function Registrations() {
  const { items } = await api<{ items: RegistrationSummary[] }>(
    '/api/v1/admin/registrations?status=pending',
  );
  return (
    <div>
      <h1 className="text-2xl font-semibold">Organisations awaiting approval</h1>
      <p className="mt-1 text-muted">
        Check the email domain belongs to the organisation before approving. Approval emails the
        admin a link to set a password and authenticator.
      </p>
      <div className="mt-6">
        {items.length ? (
          <ul className="divide-y divide-line rounded-m border border-line bg-surface">
            {items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div>
                  <p className="font-semibold">{r.organizationName}</p>
                  <p className="text-sm text-muted">
                    {r.adminName}, {r.adminEmail} (domain{' '}
                    <span className="font-mono">{r.emailDomain}</span>)
                  </p>
                </div>
                <Decide id={r.id} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No pending registrations">
            New requests appear here and are emailed to system administrators.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
