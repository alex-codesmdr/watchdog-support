'use client';
import { useEffect, useRef, useState } from 'react';

const monthName = (m: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit' }).format(
    new Date(`${m}T00:00:00`),
  );

function useWidth(min = 260) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(480);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return { box, W: w };
}

function Table({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-teal-ink">Show as table</summary>
      <table className="mt-2 w-full text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`py-1 pr-4 font-medium ${i ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r[0])} className="border-t border-line">
              {r.map((c, i) => (
                <td key={i} className={`py-1 pr-4 ${i ? 'text-right tabular-nums' : ''}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Cases opened and resolved per month: paired bars, legend, hover tooltip and a table view. */
export function MonthBars({
  months,
}: {
  months: { month: string; opened: number; resolved: number }[];
}) {
  const { box, W } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 200;
  const pad = { l: 36, r: 8, t: 12, b: 26 };
  const max = Math.max(4, ...months.flatMap((m) => [m.opened, m.resolved]));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = plotW / Math.max(1, months.length);
  const barW = Math.max(4, Math.min(18, band / 2 - 4));
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;
  const h = hover !== null ? months[hover] : null;
  return (
    <figure className="space-y-3">
      <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="font-semibold">Cases per month</span>
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
          aria-label="Cases opened and resolved per month. Exact values are in the table below."
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
          {months.map((m, i) => {
            const cx = pad.l + band * i + band / 2;
            const bar = (v: number, x: number, cls: string) =>
              v > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(v) + 3} q0,-3 3,-3 h${barW - 6} q3,0 3,3 V${y(0)} Z`}
                  className={cls}
                />
              );
            return (
              <g key={m.month}>
                {hover === i && (
                  <rect
                    x={pad.l + band * i}
                    y={pad.t}
                    width={band}
                    height={plotH}
                    className="fill-ink/5"
                  />
                )}
                {bar(m.opened, cx - barW - 1, 'fill-chart-1')}
                {bar(m.resolved, cx + 1, 'fill-chart-2')}
                <text x={cx} y={H - 8} textAnchor="middle" className="fill-muted text-[11px]">
                  {monthName(m.month)}
                </text>
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
            style={{ left: `${Math.min(70, ((pad.l + band * hover + band) / W) * 100)}%` }}
          >
            <p className="font-semibold">{monthName(h.month)}</p>
            <p>Opened {h.opened}</p>
            <p>Resolved {h.resolved}</p>
          </div>
        )}
      </div>
      <Table
        caption="Cases per month"
        head={['Month', 'Opened', 'Resolved']}
        rows={months.map((m) => [monthName(m.month), m.opened, m.resolved])}
      />
    </figure>
  );
}

/**
 * One measure per month as a line with markers. Months with no value leave a gap rather than
 * dropping to zero. The y-axis is fixed (0–100 % or 1–5) so months compare honestly.
 */
export function MonthLine({
  title,
  months,
  min,
  max,
  ticks,
  unit,
  note,
}: {
  title: string;
  months: { month: string; value: number | null; note?: string }[];
  min: number;
  max: number;
  ticks: number[];
  unit: 'percent' | 'score';
  note?: string;
}) {
  const format = (v: number) =>
    unit === 'percent'
      ? `${Math.round(v * 10) / 10}%`
      : Number.isInteger(v)
        ? String(v)
        : v.toFixed(1);
  const { box, W } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 180;
  const pad = { l: 40, r: 12, t: 14, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = plotW / Math.max(1, months.length);
  const x = (i: number) => pad.l + band * i + band / 2;
  const y = (v: number) => pad.t + plotH - ((v - min) / (max - min)) * plotH;
  // Runs of consecutive months with a value become separate line segments.
  const runs: { i: number; v: number }[][] = [];
  months.forEach((m, i) => {
    if (m.value === null) return;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1]!.i === i - 1) last.push({ i, v: m.value });
    else runs.push([{ i, v: m.value }]);
  });
  const h = hover !== null ? months[hover] : null;
  return (
    <figure className="space-y-3">
      <figcaption className="text-sm">
        <span className="font-semibold">{title}</span>
        {note && <span className="ml-2 text-muted">{note}</span>}
      </figcaption>
      <div className="relative" ref={box}>
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block"
          role="img"
          aria-label={`${title} per month. Exact values are in the table below.`}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t, i) => (
            <g key={t}>
              <line
                x1={pad.l}
                x2={W - pad.r}
                y1={y(t)}
                y2={y(t)}
                className={i === 0 ? 'stroke-muted/60' : 'stroke-line'}
                strokeWidth={1}
              />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-muted text-[11px]">
                {format(t)}
              </text>
            </g>
          ))}
          {runs.map((r) => (
            <polyline
              key={r[0]!.i}
              points={r.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
              fill="none"
              className="stroke-chart-1"
              strokeWidth={2}
              strokeLinejoin="round"
            />
          ))}
          {months.map((m, i) => (
            <g key={m.month}>
              {hover === i && (
                <line
                  x1={x(i)}
                  x2={x(i)}
                  y1={pad.t}
                  y2={pad.t + plotH}
                  className="stroke-muted/60"
                  strokeWidth={1}
                />
              )}
              {m.value !== null && (
                <circle
                  cx={x(i)}
                  cy={y(m.value)}
                  r={4}
                  className="fill-chart-1 stroke-surface"
                  strokeWidth={2}
                />
              )}
              <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted text-[11px]">
                {monthName(m.month)}
              </text>
              <rect
                x={pad.l + band * i}
                y={pad.t}
                width={band}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          ))}
        </svg>
        {h && hover !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 rounded-s border border-line bg-surface px-3 py-2 text-xs shadow-sm"
            style={{ left: `${Math.min(70, (x(hover) / W) * 100)}%` }}
          >
            <p className="font-semibold">{monthName(h.month)}</p>
            <p>{h.value === null ? 'No data' : format(h.value)}</p>
            {h.note && <p className="text-muted">{h.note}</p>}
          </div>
        )}
      </div>
      <Table
        caption={title}
        head={['Month', title]}
        rows={months.map((m) => [
          monthName(m.month),
          m.value === null ? '—' : `${format(m.value)}${m.note ? ` (${m.note})` : ''}`,
        ])}
      />
    </figure>
  );
}
