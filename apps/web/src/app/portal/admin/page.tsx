import { notFound } from 'next/navigation';
import type { Me } from '@wd/contracts';
import { ToolHub } from '@/components/tool-hub';
import { api } from '@/lib/api';
import { CUSTOMER_ADMIN_TOOLS, toolsFor } from '@/lib/tools';

export const metadata = { title: 'Administration' };

export default async function PortalAdmin() {
  const me = await api<Me>('/api/v1/me');
  const tools = toolsFor(CUSTOMER_ADMIN_TOOLS, me.permissions);
  if (!tools.length) notFound();
  return (
    <ToolHub
      title="Administration"
      lead={`Tools for ${me.org.name} administrators.`}
      tools={tools}
    />
  );
}
