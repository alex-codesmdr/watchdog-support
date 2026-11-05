import { notFound } from 'next/navigation';
import type { Me } from '@wd/contracts';
import { ToolHub } from '@/components/tool-hub';
import { api } from '@/lib/api';
import { STAFF_TOOLS, toolsFor } from '@/lib/tools';

export const metadata = { title: 'Admin' };

export default async function AdminHome() {
  const me = await api<Me>('/api/v1/me');
  const tools = toolsFor(STAFF_TOOLS, me.permissions);
  if (!tools.length) notFound();
  return (
    <ToolHub
      title="Admin"
      lead="Reports, customer set-up, published content and portal settings."
      tools={tools}
    />
  );
}
