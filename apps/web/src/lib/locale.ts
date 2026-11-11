import 'server-only';
import { cookies } from 'next/headers';
import { asLocale, type Locale, tr } from './i18n';

/** The visitor's language: the wd-lang cookie set by the language switch or the account page. */
export async function getLocale(): Promise<Locale> {
  return asLocale((await cookies()).get('wd-lang')?.value);
}
/** A translator bound to the visitor's language, for server components. */
export async function serverT() {
  const l = await getLocale();
  return (text: string, vars?: Record<string, string | number>) => tr(text, l, vars);
}
