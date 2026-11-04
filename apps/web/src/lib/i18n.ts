import en from '../../messages/en.json';

/**
 * Message lookup. English ships in Phase 2; Hindi (hi.json) uses the same keys in Phase 4.
 * Keys are dotted paths into messages/<locale>.json.
 */
type Messages = typeof en;
const catalogs: Record<string, Messages> = { en };

export function t(key: string, locale = 'en'): string {
  const v = key
    .split('.')
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown> | undefined)?.[k],
      catalogs[locale] ?? en,
    );
  return typeof v === 'string' ? v : key;
}
export function tl(key: string, locale = 'en'): string[] {
  const v = key
    .split('.')
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown> | undefined)?.[k],
      catalogs[locale] ?? en,
    );
  return Array.isArray(v) ? (v as string[]) : [key];
}
