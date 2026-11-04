import { notFound } from 'next/navigation';
import type { Me } from '@wd/contracts';
import { api } from '@/lib/api';
import { ArticleEditor } from '../editor';

export const metadata = { title: 'New article' };

export default async function NewArticle() {
  const me = await api<Me>('/api/v1/me');
  if (!me.permissions.includes('kb:draft')) notFound();
  return <ArticleEditor canPublish={me.permissions.includes('kb:publish')} />;
}
