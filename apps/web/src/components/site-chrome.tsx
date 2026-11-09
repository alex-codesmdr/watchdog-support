import Link from 'next/link';
import { CUSTOMER_ADMIN_TOOLS, STAFF_TOOLS, toolsFor } from '@/lib/tools';
import type { Me } from '@wd/contracts';
import { Wordmark } from '@wd/ui';
import { t } from '@/lib/i18n';
import { getSession } from '@/lib/session';
import { portalSettings } from '@/lib/settings';
import { cookies } from 'next/headers';
import { ThemeSwitch, type Theme } from '@/components/theme-switch';
import { api } from '@/lib/api';
import { AnnouncementBanners } from '@/components/announcements/banner';
import type { Announcement } from '@wd/contracts';

const link = 'rounded-s px-2 py-1 text-sm text-white/85 hover:text-white hover:bg-white/10';

export async function SiteHeader({
  me,
  area,
}: {
  me?: Me | null;
  area?: 'portal' | 'workspace' | 'admin';
}) {
  const s = await getSession();
  const staff = me?.isInternal;
  const [notices, cfg] = await Promise.all([
    api<{ items: Announcement[] }>('/api/v1/announcements', { optionalAuth: true })
      .then((r) => r.items)
      .catch(() => []),
    portalSettings(),
  ]);
  const saved = (await cookies()).get('wd-theme')?.value;
  const theme: Theme = saved === 'light' || saved === 'dark' ? saved : 'system';
  return (
    <>
      <header className="bg-navy text-white">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-s focus:bg-white focus:px-3 focus:py-2 focus:text-navy"
        >
          {t('nav.skip')}
        </a>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="rounded-s" aria-label="WatchDog Support home">
            <Wordmark inverted />
          </Link>
          <nav
            aria-label="Main"
            className="order-3 flex w-full flex-wrap items-center gap-1 sm:order-none sm:w-auto sm:flex-1"
          >
            {me && !staff && (
              <>
                <Link className={link} href="/portal">
                  {t('nav.dashboard')}
                </Link>
                <Link className={link} href="/portal/cases">
                  {t('nav.myCases')}
                </Link>
                <Link className={link} href="/portal/assets">
                  {t('nav.devices')}
                </Link>
                {me.permissions.includes('rma:request') && (
                  <Link className={link} href="/portal/rmas">
                    {t('nav.rmas')}
                  </Link>
                )}
                <Link className={link} href="/search">
                  {t('nav.knowledge')}
                </Link>
                <Link className={link} href="/help">
                  {t('nav.ask')}
                </Link>
                {toolsFor(CUSTOMER_ADMIN_TOOLS, me.permissions).length > 0 && (
                  <Link className={link} href="/portal/admin">
                    {t('nav.administration')}
                  </Link>
                )}
              </>
            )}
            {staff && (
              <>
                {me?.permissions.includes('case:read:all') && (
                  <Link className={link} href="/workspace">
                    {t('nav.queue')}
                  </Link>
                )}
                {me?.permissions.includes('rma:manage') && (
                  <Link className={link} href="/workspace/rmas">
                    {t('nav.rmas')}
                  </Link>
                )}
                <Link className={link} href="/search">
                  {t('nav.knowledge')}
                </Link>
                {me && toolsFor(STAFF_TOOLS, me.permissions).length > 0 && (
                  <Link className={link} href="/admin">
                    {t('nav.admin')}
                  </Link>
                )}
              </>
            )}
            {!me && (
              <>
                <Link className={link} href="/search">
                  {t('nav.knowledge')}
                </Link>
                <Link className={link} href="/help">
                  {t('nav.ask')}
                </Link>
                <Link className={link} href="/downloads">
                  {t('nav.downloads')}
                </Link>
                <Link className={link} href="/advisories">
                  {t('nav.advisories')}
                </Link>
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            <ThemeSwitch initial={theme} />
            {s ? (
              <>
                {me && !staff && area !== undefined && (
                  <Link
                    href="/portal/cases/new"
                    className="hidden h-9 items-center rounded-s bg-teal px-3 text-sm font-semibold text-navy hover:bg-teal/90 sm:inline-flex"
                  >
                    {t('nav.openCase')}
                  </Link>
                )}
                {me && (
                  <Link className={link} href="/account" title={me.email}>
                    {t('nav.myAccount')}
                  </Link>
                )}
                <form action="/auth/logout" method="post">
                  <input type="hidden" name="csrf" value={s.csrf} />
                  <button className={link} type="submit" title={s.email}>
                    {t('nav.signOut')}
                  </button>
                </form>
              </>
            ) : (
              <>
                {cfg.selfRegistration && (
                  <Link className={link} href="/register">
                    {t('nav.register')}
                  </Link>
                )}
                <a
                  className="inline-flex h-9 items-center rounded-s bg-white px-3 text-sm font-semibold text-navy hover:bg-white/90"
                  href="/auth/login"
                >
                  {t('nav.signIn')}
                </a>
              </>
            )}
          </div>
        </div>
      </header>
      <AnnouncementBanners items={notices} />
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted">
        <span>
          © {new Date().getFullYear()} {t('footer.rights')}
        </span>
        <nav aria-label="Footer" className="flex flex-wrap gap-4">
          <Link className="hover:text-ink" href="/privacy">
            {t('footer.privacy')}
          </Link>
          <Link className="hover:text-ink" href="/status">
            {t('footer.status')}
          </Link>
          <Link className="hover:text-ink" href="/advisories#report">
            {t('footer.psirt')}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
