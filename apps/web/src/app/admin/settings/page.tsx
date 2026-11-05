import { notFound } from 'next/navigation';
import type { Me, PortalSettings } from '@wd/contracts';
import { api } from '@/lib/api';
import { SettingsForm } from './settings-form';

export const metadata = { title: 'Portal settings' };

export default async function SettingsPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('settings:manage')) notFound();
  const s = await api<PortalSettings>('/api/v1/admin/settings');
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Portal settings</h1>
        <p className="mt-1 text-muted">
          Contact details shown to customers, and features you can switch on or off. Changes show on
          the site within a few minutes.
        </p>
      </div>
      <SettingsForm initial={s} />
    </div>
  );
}
