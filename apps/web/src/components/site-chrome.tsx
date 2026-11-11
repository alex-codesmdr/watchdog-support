import Image from 'next/image';
import Link from 'next/link';
import { CUSTOMER_ADMIN_TOOLS, STAFF_TOOLS, toolsFor } from '@/lib/tools';
import type { Me } from '@wd/contracts';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/locale';
import { LanguageSwitch } from '@/components/locale';
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
  const locale = await getLocale();
  const theme: Theme = saved === 'light' || saved === 'dark' ? saved : 'system';
  return (
    <>
      <header className="bg-navy text-white">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-s focus:bg-white focus:px-3 focus:py-2 focus:text-navy"
        >
          {t('nav.skip', locale)}
        </a>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-s"
            aria-label="WatchDog Support home"
          >
            <Image
              src="/watchdog-logo.png"
              alt=""
              width={336}
              height={96}
              priority
              unoptimized
              className="h-10 w-auto sm:h-14"
            />
            <span className="border-l border-white/30 pl-3 text-lg font-normal text-white/90">
              Support
            </span>
          </Link>
          <nav
            aria-label="Main"
            className="order-3 flex w-full flex-wrap items-center gap-1 sm:order-none sm:w-auto sm:flex-1"
          >
            {me && !staff && (
              <>
                <Link className={link} href="/portal">
                  {t('nav.dashboard', locale)}
                </Link>
                <Link className={link} href="/portal/cases">
                  {t('nav.myCases', locale)}
                </Link>
                <Link className={link} href="/portal/assets">
                  {t('nav.devices', locale)}
                </Link>
                {me.permissions.includes('rma:request') && (
                  <Link className={link} href="/portal/rmas">
                    {t('nav.rmas', locale)}
                  </Link>
                )}
                <Link className={link} href="/search">
                  {t('nav.knowledge', locale)}
                </Link>
                <Link className={link} href="/help">
                  {t('nav.ask', locale)}
                </Link>
                {me.permissions.includes('case:read:delegated') && (
                  <Link className={link} href="/portal/customers">
                    {t('nav.customers', locale)}
                  </Link>
                )}
                {me.permissions.includes('community:post') && (
                  <Link className={link} href="/community">
                    {t('nav.community', locale)}
                  </Link>
                )}
                {me.permissions.includes('idea:submit') && (
                  <Link className={link} href="/portal/ideas">
                    {t('nav.ideas', locale)}
                  </Link>
                )}
                {toolsFor(CUSTOMER_ADMIN_TOOLS, me.permissions).length > 0 && (
                  <Link className={link} href="/portal/admin">
                    {t('nav.administration', locale)}
                  </Link>
                )}
              </>
            )}
            {staff && (
              <>
                {me?.permissions.includes('case:read:all') && (
                  <Link className={link} href="/workspace">
                    {t('nav.queue', locale)}
                  </Link>
                )}
                {me?.permissions.includes('rma:manage') && (
                  <Link className={link} href="/workspace/rmas">
                    {t('nav.rmas', locale)}
                  </Link>
                )}
                <Link className={link} href="/search">
                  {t('nav.knowledge', locale)}
                </Link>
                {me && toolsFor(STAFF_TOOLS, me.permissions).length > 0 && (
                  <Link className={link} href="/admin">
                    {t('nav.admin', locale)}
                  </Link>
                )}
              </>
            )}
            {!me && (
              <>
                <Link className={link} href="/search">
                  {t('nav.knowledge', locale)}
                </Link>
                <Link className={link} href="/help">
                  {t('nav.ask', locale)}
                </Link>
                <Link className={link} href="/downloads">
                  {t('nav.downloads', locale)}
                </Link>
                <Link className={link} href="/advisories">
                  {t('nav.advisories', locale)}
                </Link>
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            <LanguageSwitch initial={locale} />
            <ThemeSwitch initial={theme} />
            {s ? (
              <>
                {me && !staff && area !== undefined && (
                  <Link
                    href="/portal/cases/new"
                    className="hidden h-9 items-center rounded-s bg-teal px-3 text-sm font-semibold text-navy hover:bg-teal/90 sm:inline-flex"
                  >
                    {t('nav.openCase', locale)}
                  </Link>
                )}
                {me && (
                  <Link className={link} href="/account" title={me.email}>
                    {t('nav.myAccount', locale)}
                  </Link>
                )}
                <form action="/auth/logout" method="post">
                  <input type="hidden" name="csrf" value={s.csrf} />
                  <button className={link} type="submit" title={s.email}>
                    {t('nav.signOut', locale)}
                  </button>
                </form>
              </>
            ) : (
              <>
                {cfg.selfRegistration && (
                  <Link className={link} href="/register">
                    {t('nav.register', locale)}
                  </Link>
                )}
                <a
                  className="inline-flex h-9 items-center rounded-s bg-white px-3 text-sm font-semibold text-navy hover:bg-white/90"
                  href="/auth/login"
                >
                  {t('nav.signIn', locale)}
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

export async function SiteFooter() {
  const locale = await getLocale();
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted">
        <span>
          © {new Date().getFullYear()} {t('footer.rights', locale)}
        </span>
        <nav aria-label="Footer" className="flex flex-wrap gap-4">
          <Link className="hover:text-ink" href="/privacy">
            {t('footer.privacy', locale)}
          </Link>
          <Link className="hover:text-ink" href="/status">
            {t('footer.status', locale)}
          </Link>
          <Link className="hover:text-ink" href="/advisories#report">
            {t('footer.psirt', locale)}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
