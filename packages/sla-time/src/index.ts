/**
 * @wd/sla-time — deterministic business-time arithmetic for SLA clocks.
 *
 * A calendar is an IANA time zone, weekly opening windows in local wall time, and a
 * list of local-date holidays. All instants in and out are UTC `Date`s. The algorithm walks
 * one local day at a time, so cost is O(days spanned), never O(minutes).
 */

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
/** ["09:00","18:00"] — end exclusive; "24:00" allowed as an end. */
export type Window = readonly [string, string];

export interface BusinessCalendar {
  timeZone: string;
  /** When true, every minute counts (24×7 tiers); weekly/holidays are ignored. */
  twentyFourSeven?: boolean;
  weekly: Partial<Record<Weekday, readonly Window[]>>;
  /** Local dates, "YYYY-MM-DD". */
  holidays?: readonly string[];
}

const DAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MAX_DAYS = 3660; // 10 years: guard against calendars with no open time
const MS_MIN = 60_000;

export const IST_BUSINESS_CALENDAR: BusinessCalendar = {
  timeZone: 'Asia/Kolkata',
  weekly: {
    mon: [['09:00', '18:00']],
    tue: [['09:00', '18:00']],
    wed: [['09:00', '18:00']],
    thu: [['09:00', '18:00']],
    fri: [['09:00', '18:00']],
    sat: [['09:00', '13:00']],
  },
  holidays: [],
};

export const TWENTY_FOUR_SEVEN: BusinessCalendar = {
  timeZone: 'Asia/Kolkata',
  twentyFourSeven: true,
  weekly: {},
};

// ---------- time-zone helpers (Intl only, no dependencies) ----------
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

interface LocalParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

function localParts(instant: Date, tz: string): LocalParts {
  const p: Record<string, number> = {};
  for (const part of dtf(tz).formatToParts(instant)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { y: p.year!, m: p.month!, d: p.day!, hh: p.hour! % 24, mm: p.minute!, ss: p.second! };
}

/** Offset (ms) of `tz` from UTC at `instant`. */
function offsetMs(instant: Date, tz: string): number {
  const l = localParts(instant, tz);
  const asUtc = Date.UTC(l.y, l.m - 1, l.d, l.hh, l.mm, l.ss);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Converts a local wall-clock time in `tz` to a UTC instant (handles DST gaps by shifting forward). */
export function zonedToUtc(
  y: number,
  m: number,
  d: number,
  minutesOfDay: number,
  tz: string,
): Date {
  const guess = Date.UTC(y, m - 1, d, 0, minutesOfDay);
  let t = guess - offsetMs(new Date(guess), tz);
  // second pass settles transitions
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

function parseHm(s: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`sla-time: bad time "${s}"`);
  const v = Number(m[1]) * 60 + Number(m[2]);
  if (v > 24 * 60) throw new Error(`sla-time: bad time "${s}"`);
  return v;
}

const pad = (n: number) => String(n).padStart(2, '0');

interface LocalDate {
  y: number;
  m: number;
  d: number;
}
function nextDay(ld: LocalDate): LocalDate {
  const t = new Date(Date.UTC(ld.y, ld.m - 1, ld.d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Open intervals [start, end) in UTC ms for one local date. */
function openIntervals(ld: LocalDate, cal: BusinessCalendar): Array<[number, number]> {
  const key = `${ld.y}-${pad(ld.m)}-${pad(ld.d)}`;
  if (cal.holidays?.includes(key)) return [];
  const wd = DAYS[new Date(Date.UTC(ld.y, ld.m - 1, ld.d)).getUTCDay()]!;
  const windows = cal.weekly[wd] ?? [];
  const out: Array<[number, number]> = [];
  for (const [a, b] of windows) {
    const s = zonedToUtc(ld.y, ld.m, ld.d, parseHm(a), cal.timeZone).getTime();
    const e = zonedToUtc(ld.y, ld.m, ld.d, parseHm(b), cal.timeZone).getTime();
    if (e > s) out.push([s, e]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

function hasAnyOpenTime(cal: BusinessCalendar): boolean {
  return (
    cal.twentyFourSeven === true || Object.values(cal.weekly).some((w) => (w?.length ?? 0) > 0)
  );
}

/**
 * Returns the instant at which `minutes` business minutes have elapsed after `start`.
 * `addBusinessMinutes(t, 0, cal)` is `t` itself.
 */
export function addBusinessMinutes(start: Date, minutes: number, cal: BusinessCalendar): Date {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError('minutes must be >= 0');
  if (minutes === 0) return new Date(start);
  if (cal.twentyFourSeven) return new Date(start.getTime() + minutes * MS_MIN);
  if (!hasAnyOpenTime(cal)) throw new Error('sla-time: calendar has no open time');

  let remaining = minutes * MS_MIN;
  const s = localParts(start, cal.timeZone);
  let day: LocalDate = { y: s.y, m: s.m, d: s.d };
  const startMs = start.getTime();
  for (let i = 0; i < MAX_DAYS; i++, day = nextDay(day)) {
    for (const [a, b] of openIntervals(day, cal)) {
      if (b <= startMs) continue;
      const from = Math.max(a, startMs);
      const span = b - from;
      if (span >= remaining) return new Date(from + remaining);
      remaining -= span;
    }
  }
  throw new Error('sla-time: exceeded search horizon');
}

/** Business milliseconds between `a` and `b` (0 if b <= a). */
export function businessMsBetween(a: Date, b: Date, cal: BusinessCalendar): number {
  const aMs = a.getTime();
  const bMs = b.getTime();
  if (bMs <= aMs) return 0;
  if (cal.twentyFourSeven) return bMs - aMs;
  let total = 0;
  const s = localParts(a, cal.timeZone);
  let day: LocalDate = { y: s.y, m: s.m, d: s.d };
  for (let i = 0; i < MAX_DAYS; i++, day = nextDay(day)) {
    const intervals = openIntervals(day, cal);
    const dayStart = zonedToUtc(day.y, day.m, day.d, 0, cal.timeZone).getTime();
    if (dayStart >= bMs) break;
    for (const [x, y] of intervals) {
      const from = Math.max(x, aMs);
      const to = Math.min(y, bMs);
      if (to > from) total += to - from;
    }
  }
  return total;
}

export function businessMinutesBetween(a: Date, b: Date, cal: BusinessCalendar): number {
  return Math.floor(businessMsBetween(a, b, cal) / MS_MIN);
}

/** True if `t` falls inside an open window. */
export function isOpen(t: Date, cal: BusinessCalendar): boolean {
  if (cal.twentyFourSeven) return true;
  const l = localParts(t, cal.timeZone);
  return openIntervals({ y: l.y, m: l.m, d: l.d }, cal).some(
    ([a, b]) => t.getTime() >= a && t.getTime() < b,
  );
}

// ---------- clock evaluation (shared by API responses and the breach worker) ----------
export interface ClockState {
  startedAt: Date;
  targetMinutes: number;
  /** Business ms spent paused so far (closed pauses). */
  pausedMs: number;
  /** Set while paused. */
  pausedAt: Date | null;
  metAt: Date | null;
}

/** Due instant given the pause time already accumulated. While paused the due date floats. */
export function dueAt(c: ClockState, cal: BusinessCalendar, now: Date = new Date()): Date {
  const pausedMs = c.pausedMs + (c.pausedAt ? businessMsBetween(c.pausedAt, now, cal) : 0);
  return addBusinessMinutes(c.startedAt, c.targetMinutes + pausedMs / MS_MIN, cal);
}

export function evaluate(
  c: ClockState,
  cal: BusinessCalendar,
  now: Date = new Date(),
): { dueAt: Date; remainingSeconds: number; percentElapsed: number; breached: boolean } {
  const end = c.metAt ?? c.pausedAt ?? now;
  const elapsedMs = Math.max(0, businessMsBetween(c.startedAt, end, cal) - c.pausedMs);
  const budgetMs = c.targetMinutes * MS_MIN;
  const due = dueAt(c, cal, now);
  return {
    dueAt: due,
    remainingSeconds: Math.round((budgetMs - elapsedMs) / 1000),
    percentElapsed: budgetMs === 0 ? 100 : Math.round((elapsedMs / budgetMs) * 1000) / 10,
    breached: elapsedMs > budgetMs,
  };
}

/** Warning thresholds from the SLA design (§6.4). */
export const WARN_THRESHOLDS = [50, 75, 90, 100] as const;
export function crossedThreshold(percent: number, lastWarned: number): number | null {
  const next = WARN_THRESHOLDS.filter((t) => percent >= t && t > lastWarned);
  return next.length ? next[next.length - 1]! : null;
}
