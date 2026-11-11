import en from '../../messages/en.json';
import hi from '../../messages/hi.json';
import hiPhrases from '../../messages/hi-phrases.json';

/**
 * Page text in English or Hindi.
 *  - t('nav.dashboard', locale): keyed messages from messages/<locale>.json.
 *  - tr('Open a case', locale, { n }): English text as the key, looked up in
 *    messages/hi-phrases.json; {name} placeholders are filled from vars. Anything without a
 *    Hindi entry stays in English, so a missing translation never breaks a page.
 */
export type Locale = 'en' | 'hi';
type Messages = typeof en;
const catalogs: Record<Locale, Messages> = { en, hi: hi as Messages };
const phrases: Record<string, string> = hiPhrases;

export const asLocale = (v: string | null | undefined): Locale =>
  v && v.toLowerCase().startsWith('hi') ? 'hi' : 'en';

const walk = (key: string, root: unknown) =>
  key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], root);

export function t(key: string, locale: Locale = 'en'): string {
  const v = walk(key, catalogs[locale]) ?? walk(key, en);
  return typeof v === 'string' ? v : key;
}
export function tl(key: string, locale: Locale = 'en'): string[] {
  const v = walk(key, catalogs[locale]) ?? walk(key, en);
  return Array.isArray(v) ? (v as string[]) : [key];
}
export function tr(
  text: string,
  locale: Locale = 'en',
  vars?: Record<string, string | number>,
): string {
  const s = locale === 'hi' ? (phrases[text] ?? text) : text;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : s;
}
/** Every phrase that has a Hindi entry (for the completeness test). */
export const HI_PHRASES = phrases;
