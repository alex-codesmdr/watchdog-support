'use client';
import type { Announcement } from '@wd/contracts';
import { cn } from '@wd/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const KEY = 'wd.dismissed-announcements';
const TONE = {
  info: { cls: 'border-navy/15 bg-surface', label: 'Notice' },
  maintenance: { cls: 'border-amber/50 bg-amber/10', label: 'Planned maintenance' },
  incident: { cls: 'border-danger/50 bg-danger/10', label: 'Service incident' },
} as const;

const read = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};

/** Portal-wide banners. Dismissals are remembered in this browser only; incidents stay up. */
export function AnnouncementBanners({ items }: { items: Announcement[] }) {
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => setHidden(read()), []);
  const shown = items.filter((a) => !a.dismissible || !hidden.includes(a.id));
  if (!shown.length) return null;
  const dismiss = (id: string) => {
    const next = [...new Set([...read(), id])].slice(-50);
    setHidden(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: hidden for this page view only */
    }
  };
  return (
    <section aria-label="Announcements" className="border-b border-line bg-paper">
      <ul className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2">
        {shown.map((a) => (
          <li
            key={a.id}
            className={cn(
              'flex items-start gap-3 rounded-s border px-3 py-2 text-sm text-ink',
              TONE[a.tone].cls,
            )}
          >
            <p className="flex-1">
              <span className="font-semibold">{TONE[a.tone].label}: </span>
              <span className="font-semibold">{a.title}</span>
              {a.body && <span> {a.body}</span>}
              {a.linkUrl && (
                <>
                  {' '}
                  {a.linkUrl.startsWith('/') ? (
                    <Link href={a.linkUrl} className="text-teal-ink underline underline-offset-2">
                      Details
                    </Link>
                  ) : (
                    <a
                      href={a.linkUrl}
                      rel="noopener noreferrer"
                      className="text-teal-ink underline underline-offset-2"
                    >
                      Details
                    </a>
                  )}
                </>
              )}
            </p>
            {a.dismissible && (
              <button
                type="button"
                onClick={() => dismiss(a.id)}
                className="rounded-s px-2 text-muted hover:text-ink"
                aria-label={`Dismiss: ${a.title}`}
              >
                Dismiss
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
