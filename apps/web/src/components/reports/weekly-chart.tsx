'use client';
import { useEffect, useRef, useState } from 'react';

type Week = { weekStart: string; opened: number; resolved: number };
const fmt = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(
    new Date(`${d}T00:00:00`),
  );

/**
 * Cases opened and resolved per week: paired bars on one axis, legend, hover/focus tooltip and a
 * table view for screen readers and exact values.
 */
export function WeeklyChart({ weeks }: { weeks: Week[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the real on-screen width so text stays at its intended size on every screen.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 220;
  const pad = { l: 36, r: 8, t: 12, b: 28 };
  const max = Math.max(4, ...weeks.flatMap((w) => [w.opened, w.resolved]));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = plotW / Math.max(1, weeks.length);
  const barW = Math.max(3, Math.min(14, band / 2 - 3));
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;
  const labelEvery = Math.ceil(weeks.length / Math.max(2, Math.floor(plotW / 70)));
  const h = hover !== null ? weeks[hover] : null;

  return (
    <figure className="space-y-3">
      <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="font-semibold">Cases per week</span>
        <span className="flex items-center gap-1.5 text-muted">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-chart-1" /> Opened
        </span>
        <span className="flex items-center gap-1.5 text-muted">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-chart-2" /> Resolved
        </span>
      </figcaption>
      <div className="relative" ref={box}>
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block"
          role="img"
          aria-label="Cases opened and resolved per week. Exact values are in the table below."
          onMouseLeave={() => setHover(null)}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line
                x1={pad.l}
                x2={W - pad.r}
                y1={y(i * step)}
                y2={y(i * step)}
                className={i === 0 ? 'stroke-muted/60' : 'stroke-line'}
                strokeWidth={1}
              />
              <text
                x={pad.l - 6}
                y={y(i * step) + 4}
                textAnchor="end"
                className="fill-muted text-[11px]"
              >
                {i * step}
              </text>
            </g>
          ))}
          {weeks.map((w, i) => {
            const cx = pad.l + band * i + band / 2;
            const bar = (v: number, x: number, cls: string) =>
              v > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(v) + 2} q0,-2 2,-2 h${barW - 4} q2,0 2,2 V${y(0)} Z`}
                  className={cls}
                />
              );
            return (
              <g key={w.weekStart}>
                {hover === i && (
                  <rect
                    x={pad.l + band * i}
                    y={pad.t}
                    width={band}
                    height={plotH}
                    className="fill-ink/5"
                  />
                )}
                {bar(w.opened, cx - barW - 1, 'fill-chart-1')}
                {bar(w.resolved, cx + 1, 'fill-chart-2')}
                {i % labelEvery === 0 && (
                  <text x={cx} y={H - 8} textAnchor="middle" className="fill-muted text-[11px]">
                    {fmt(w.weekStart)}
                  </text>
                )}
                {/* Hit target: the whole week column, larger than the bars. */}
                <rect
                  x={pad.l + band * i}
                  y={pad.t}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            );
          })}
        </svg>
        {h && hover !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 rounded-s border border-line bg-surface px-3 py-2 text-xs shadow-sm"
            style={{
              left: `${Math.min(80, ((pad.l + band * hover + band) / W) * 100)}%`,
            }}
          >
            <p className="font-semibold">Week of {fmt(h.weekStart)}</p>
            <p>
              <span
                aria-hidden="true"
                className="mr-1.5 inline-block size-2 rounded-sm bg-chart-1"
              />
              Opened {h.opened}
            </p>
            <p>
              <span
                aria-hidden="true"
                className="mr-1.5 inline-block size-2 rounded-sm bg-chart-2"
              />
              Resolved {h.resolved}
            </p>
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-teal-ink">Show as table</summary>
        <div
          className="mt-2 max-h-64 overflow-y-auto"
          tabIndex={0}
          role="region"
          aria-label="Cases per week"
        >
          <table className="w-full text-left">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-4 font-medium">Week of</th>
                <th className="py-1 pr-4 text-right font-medium">Opened</th>
                <th className="py-1 text-right font-medium">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.weekStart} className="border-t border-line">
                  <td className="py-1 pr-4">{fmt(w.weekStart)}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{w.opened}</td>
                  <td className="py-1 text-right tabular-nums">{w.resolved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
