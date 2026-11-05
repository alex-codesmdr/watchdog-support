import { notFound } from 'next/navigation';
import type { Me, OpsReport } from '@wd/contracts';
import { OpsReportView } from '@/components/reports/ops-report';
import { api } from '@/lib/api';

export const metadata = { title: 'Support report' };

export default async function PortalReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('report:ops:read:org')) notFound();
  const sp = await searchParams;
  const qs = new URLSearchParams({
    ...(sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? { from: sp.from } : {}),
    ...(sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? { to: sp.to } : {}),
  });
  const r = await api<OpsReport>(`/api/v1/reports/operations?${qs}`);
  return <OpsReportView r={r} basePath="/portal/reports" />;
}
