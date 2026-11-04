import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Tells client code whether a session exists and hands it the CSRF token for mutations. */
export async function GET() {
  const s = await getSession();
  return NextResponse.json(
    s ? { authenticated: true, csrf: s.csrf, name: s.name } : { authenticated: false },
    { headers: { 'cache-control': 'no-store' } },
  );
}
