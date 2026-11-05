import Link from 'next/link';
import { ConsoleSearch } from '@/components/console-search';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { api } from '@/lib/api';
import { t, tl } from '@/lib/i18n';
import { portalSettings } from '@/lib/settings';

export const revalidate = 300;

interface Family {
  key: string;
  name: string;
  description: string;
  productCount: number;
}

async function families(): Promise<Family[]> {
  try {
    return (await api<{ items: Family[] }>('/api/v1/catalog/families', { public: true })).items;
  } catch {
    return [];
  }
}

const ACTIONS: Array<[string, string]> = [
  ['openCase', '/portal/cases/new'],
  ['warranty', '/warranty'],
  ['firmware', '/downloads'],
  ['rma', '/portal/cases'],
  ['advisories', '/advisories'],
];

export default async function Home() {
  const [fams, cfg] = await Promise.all([families(), portalSettings()]);
  const actions = ACTIONS.filter(([k]) => k !== 'warranty' || cfg.publicWarrantyCheck);
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="bg-navy pb-14 pt-10 text-white sm:pt-16">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 lg:grid-cols-[1.3fr_1fr] lg:items-end">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.9rem] sm:leading-[1.1]">
                {t('home.title')}
              </h1>
              <p className="mt-4 max-w-xl text-lg text-white/80">{t('home.lead')}</p>
              <div className="mt-8">
                <ConsoleSearch label={t('home.searchLabel')} button={t('home.searchButton')} />
              </div>
            </div>
            <nav aria-label="Quick actions">
              <ul className="divide-y divide-white/10 border-y border-white/10">
                {actions.map(([k, href]) => {
                  const [title, desc] = tl(`home.actions.${k}`);
                  return (
                    <li key={k}>
                      <Link
                        href={href}
                        className="group flex flex-col gap-0.5 px-1 py-3 hover:bg-white/5"
                      >
                        <span className="font-semibold text-white group-hover:text-teal">
                          {title}
                        </span>
                        <span className="text-sm text-white/70">{desc}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pt-12" aria-labelledby="fam">
          <h2 id="fam" className="text-xl font-semibold">
            {t('home.families')}
          </h2>
          {fams.length ? (
            <ul className="mt-5 grid overflow-hidden rounded-m border-l border-t border-line bg-surface sm:grid-cols-2 lg:grid-cols-4">
              {fams.map((f) => (
                <li key={f.key} className="border-b border-r border-line">
                  <Link
                    href={`/products/${f.key}`}
                    className="flex h-full flex-col gap-1 p-5 hover:bg-paper"
                  >
                    <span className="font-semibold">{f.name}</span>
                    <span className="text-sm text-muted">{f.description}</span>
                    <span className="mt-auto pt-3 text-xs text-muted">
                      {f.productCount} {f.productCount === 1 ? 'model' : 'models'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted">
              The product catalogue is unavailable right now. Search and case creation still work.
            </p>
          )}
        </section>

        <section
          className="mx-auto mt-12 grid max-w-6xl gap-8 px-4 md:grid-cols-[1fr_1.4fr]"
          aria-labelledby="contact"
        >
          <div>
            <h2 id="contact" className="text-xl font-semibold">
              {t('home.contact')}
            </h2>
            <p className="mt-2 max-w-md text-muted">{t('home.contactLead')}</p>
          </div>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Support phone lines by severity</caption>
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="py-2 font-medium">
                  Severity
                </th>
                <th scope="col" className="py-2 font-medium">
                  Line
                </th>
                <th scope="col" className="py-2 font-medium">
                  Hours
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line">
                <td className="py-3 font-semibold text-danger">P1 outage</td>
                <td className="py-3 font-mono">{cfg.p1Phone}</td>
                <td className="py-3">24×7, all regions</td>
              </tr>
              <tr className="border-b border-line">
                <td className="py-3 font-semibold">P2 degraded</td>
                <td className="py-3 font-mono">{cfg.p2Phone}</td>
                <td className="py-3">24×7 for Premium and Mission-Critical</td>
              </tr>
              <tr>
                <td className="py-3">P3 / P4</td>
                <td className="py-3">Online case</td>
                <td className="py-3">{cfg.businessHours}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
