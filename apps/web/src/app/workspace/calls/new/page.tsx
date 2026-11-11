import { notFound } from 'next/navigation';
import type { Me } from '@wd/contracts';
import { api } from '@/lib/api';
import { CallForm } from './call-form';

export const metadata = { title: 'Log a phone call' };

export default async function LogCallPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('case:create:on_behalf')) notFound();
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Log a phone call</h1>
        <p className="mt-1 text-muted">
          Open a case for a customer who phoned. SLA timers start from when the call came in, and
          the caller gets the usual case emails.
        </p>
      </div>
      <CallForm />
    </div>
  );
}
