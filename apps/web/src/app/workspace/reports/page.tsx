import { notFound } from 'next/navigation';
import type { Me, OpsReport } from '@wd/contracts';
import { OpsReportView } from '@/components/reports/ops-report';
import { api } from '@/lib/api';

export const metadata = { title: 'Support report' };

export default async function WorkspaceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; orgId?: string }>;
}) {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('report:ops:read:all')) notFound();
  const sp = await searchParams;
  const qs = new URLSearchParams({
    ...(sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? { from: sp.from } : {}),
    ...(sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? { to: sp.to } : {}),
    ...(sp.orgId && /^[0-9a-f-]{36}$/.test(sp.orgId) ? { orgId: sp.orgId } : {}),
  });
  const [r, orgs] = await Promise.all([
    api<OpsReport>(`/api/v1/reports/operations?${qs}`),
    api<{ items: { id: string; name: string }[] }>('/api/v1/organizations').catch(() => ({
      items: [],
    })),
  ]);
  return <OpsReportView r={r} basePath="/workspace/reports" orgs={orgs.items} />;
}
