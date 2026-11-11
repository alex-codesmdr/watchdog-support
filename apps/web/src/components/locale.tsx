'use client';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { tr, type Locale } from '@/lib/i18n';

const Ctx = createContext<Locale>('en');
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}
export const useLocale = () => useContext(Ctx);
/** Translator for client components: useT()('Open a case'). */
export function useT() {
  const l = useContext(Ctx);
  return useCallback(
    (text: string, vars?: Record<string, string | number>) => tr(text, l, vars),
    [l],
  );
}

/** Sets the language cookie (a year) and reloads the page in that language. */
export function setLanguage(l: Locale) {
  document.cookie = `wd-lang=${l}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  document.documentElement.lang = l === 'hi' ? 'hi-IN' : 'en-IN';
  location.reload();
}

export function LanguageSwitch({ initial }: { initial: Locale }) {
  return (
    <label className="flex items-center gap-1 text-sm text-white/80">
      <span className="sr-only">Language / भाषा</span>
      <select
        value={initial}
        onChange={(e) => setLanguage(e.target.value as Locale)}
        className="h-8 rounded-s border border-white/30 bg-navy px-1 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal"
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="hi" lang="hi">
          हिन्दी
        </option>
      </select>
    </label>
  );
}
