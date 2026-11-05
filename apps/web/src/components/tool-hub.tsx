import Link from 'next/link';
import type { Tool } from '@/lib/tools';

/** A plain list of the tools a person can use, grouped. */
export function ToolHub({ title, lead, tools }: { title: string; lead: string; tools: Tool[] }) {
  const groups = [...new Set(tools.map((t) => t.group))];
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-muted">{lead}</p>
      </div>
      {groups.map((g) => (
        <section key={g} aria-labelledby={`g-${g}`}>
          <h2 id={`g-${g}`} className="text-sm font-semibold text-muted">
            {g}
          </h2>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {tools
              .filter((t) => t.group === g)
              .map((t) => (
                <li key={t.href} className="py-3">
                  <Link
                    href={t.href}
                    className="font-medium text-teal-ink underline underline-offset-2"
                  >
                    {t.label}
                  </Link>
                  <p className="text-sm text-muted">{t.desc}</p>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
