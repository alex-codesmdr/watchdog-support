'use client';
import { useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';

/** Light, dark, or follow the device. Remembered for a year in a cookie the server reads. */
export function ThemeSwitch({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const apply = (t: Theme) => {
    setTheme(t);
    const root = document.documentElement;
    if (t === 'system') delete root.dataset.theme;
    else root.dataset.theme = t;
    document.cookie = `wd-theme=${t}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  };
  return (
    <label className="flex items-center gap-1 text-sm text-white/80">
      <span className="sr-only">Colour theme</span>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="currentColor">
        <path d="M10 2a8 8 0 1 0 0 16V2Z" />
        <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <select
        value={theme}
        onChange={(e) => apply(e.target.value as Theme)}
        className="h-8 rounded-s border border-white/30 bg-navy px-1 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal"
      >
        <option value="system">Device</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
