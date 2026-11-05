import { notFound } from 'next/navigation';
import type { ApiKeyView, Me, WebhookView } from '@wd/contracts';
import { api } from '@/lib/api';
import { Integrations } from './integrations';

export const metadata = { title: 'API keys and webhooks' };

export default async function IntegrationsPage() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('integration:manage')) notFound();
  const [keys, hooks] = await Promise.all([
    api<{ items: ApiKeyView[] }>('/api/v1/org/api-keys'),
    api<{ items: WebhookView[] }>('/api/v1/org/webhooks'),
  ]);
  return <Integrations keys={keys.items} hooks={hooks.items} />;
}
