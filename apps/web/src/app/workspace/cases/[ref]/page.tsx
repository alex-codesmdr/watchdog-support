import { notFound } from 'next/navigation';
import type { CaseDetail, Me } from '@wd/contracts';
import { CaseView } from '@/components/case/case-view';
import { api, ApiError } from '@/lib/api';

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return { title: (await params).ref };
}

export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { ref } = await params;
  const { created } = await searchParams;
  try {
    const [c, me] = await Promise.all([
      api<CaseDetail>(`/api/v1/cases/${encodeURIComponent(ref)}`),
      api<Me>('/api/v1/me'),
    ]);
    return (
      <CaseView initial={c} staff={me.isInternal} meId={me.id} justCreated={created === '1'} />
    );
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
}
