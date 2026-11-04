import { notFound } from 'next/navigation';
import type { Me, RmaView } from '@wd/contracts';
import { RmaDetail } from '@/components/rma/rma-detail';
import { api, ApiError } from '@/lib/api';

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }) {
  return { title: (await params).number };
}

export default async function RmaPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  if (!/^RMA-\d{4}-\d{6}$/.test(number)) notFound();
  try {
    const [r, me] = await Promise.all([
      api<RmaView>(`/api/v1/rmas/${number}`),
      api<Me>('/api/v1/me'),
    ]);
    return <RmaDetail initial={r} staff={me.isInternal} caseBase="/workspace/cases" />;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
}
