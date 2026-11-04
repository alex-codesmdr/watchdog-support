'use client';
import { useEffect, useState } from 'react';

// Real-looking device output: what engineers actually paste into a support search.
const SAMPLES = [
  '%DEV/1/REBOOT: Board 1 restarted (watchdog timeout)',
  'BGP neighbour 10.20.0.1 Down - hold timer expired',
  'WD-SW5600-48P PoE budget exceeded on Ten1/0/7',
  'IPsec SA negotiation failed: no proposal chosen',
  'AP720 radio 2 DFS radar detected, channel 100 -> 36',
];

export function ConsoleSearch({ label, button }: { label: string; button: string }) {
  const [i, setI] = useState(0);
  const [q, setQ] = useState('');
  const [still, setStill] = useState(false);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStill(true);
      return;
    }
    const id = setInterval(() => setI((x) => (x + 1) % SAMPLES.length), 3200);
    return () => clearInterval(id);
  }, []);
  return (
    <form action="/search" method="get" role="search" className="w-full">
      <label htmlFor="q" className="mb-2 block text-sm text-white/80">
        {label}
      </label>
      <div className="flex overflow-hidden rounded-m border border-white/20 bg-[#06182e] focus-within:border-teal">
        <span
          className="hidden select-none items-center pl-4 font-mono text-teal sm:flex"
          aria-hidden="true"
        >
          wd#
        </span>
        <input
          id="q"
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={still ? SAMPLES[0] : SAMPLES[i]}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent px-3 py-4 font-mono text-[0.95rem] text-white placeholder:text-white/40 focus:outline-none"
        />
        <button
          type="submit"
          className="bg-teal px-5 font-semibold text-navy hover:bg-teal/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-white"
        >
          {button}
        </button>
      </div>
    </form>
  );
}
