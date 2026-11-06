import type { AssetSummary, Me, RenewalView, SiteView } from '@wd/contracts';
import { api } from '@/lib/api';
import { Devices } from './devices';

export const metadata = { title: 'Devices' };

export default async function DevicesPage() {
  const [me, assets, sites, renewals] = await Promise.all([
    api<Me>('/api/v1/me'),
    api<{ items: AssetSummary[] }>('/api/v1/assets'),
    api<{ items: SiteView[] }>('/api/v1/sites'),
    api<{ items: RenewalView[] }>('/api/v1/renewal-requests').catch(() => ({
      items: [] as RenewalView[],
    })),
  ]);
  return (
    <Devices
      assets={assets.items}
      sites={sites.items}
      openRenewals={renewals.items.filter((r) => r.status === 'requested').map((r) => r.assetId)}
      canManage={me.permissions.includes('asset:manage:org')}
      canRenew={me.permissions.includes('renewal:request')}
      today={new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())}
    />
  );
}
