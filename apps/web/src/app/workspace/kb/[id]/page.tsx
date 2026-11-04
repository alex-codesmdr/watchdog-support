import { notFound } from 'next/navigation';
import type { KbEditorArticle, Me } from '@wd/contracts';
import { api, ApiError } from '@/lib/api';
import { ArticleEditor } from '../editor';

export const metadata = { title: 'Edit article' };

export default async function EditArticle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('kb:draft')) notFound();
  try {
    const a = await api<KbEditorArticle>(`/api/v1/kb/editor/articles/${encodeURIComponent(id)}`);
    return <ArticleEditor initial={a} canPublish={me.permissions.includes('kb:publish')} />;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
}
