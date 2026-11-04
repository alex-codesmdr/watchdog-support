import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  businessMsBetween,
  crossedThreshold,
  evaluate,
  IST_BUSINESS_CALENDAR as IST,
  TWENTY_FOUR_SEVEN,
  type BusinessCalendar,
} from './index.js';

// IST is UTC+05:30. 09:00 IST == 03:30Z.
const ist = (s: string) => new Date(`${s}+05:30`);

describe('addBusinessMinutes (IST, Mon–Fri 09–18, Sat 09–13)', () => {
  it('adds within the same day', () => {
    expect(addBusinessMinutes(ist('2026-11-04T10:00:00'), 120, IST).toISOString()).toBe(
      ist('2026-11-04T12:00:00').toISOString(),
    );
  });
  it('rolls over to the next business day', () => {
    // Wed 17:00 + 2h -> Thu 10:00
    expect(addBusinessMinutes(ist('2026-11-04T17:00:00'), 120, IST).toISOString()).toBe(
      ist('2026-11-05T10:00:00').toISOString(),
    );
  });
  it('starts the clock at opening time when raised out of hours', () => {
    // Sun 22:00 + 30m -> Mon 09:30
    expect(addBusinessMinutes(ist('2026-11-08T22:00:00'), 30, IST).toISOString()).toBe(
      ist('2026-11-09T09:30:00').toISOString(),
    );
  });
  it('honours the Saturday half day and skips Sunday', () => {
    // Sat 12:00 + 2h -> 1h Sat, then Mon 10:00
    expect(addBusinessMinutes(ist('2026-11-07T12:00:00'), 120, IST).toISOString()).toBe(
      ist('2026-11-09T10:00:00').toISOString(),
    );
  });
  it('skips holidays', () => {
    const cal: BusinessCalendar = { ...IST, holidays: ['2026-11-05'] };
    expect(addBusinessMinutes(ist('2026-11-04T17:00:00'), 120, cal).toISOString()).toBe(
      ist('2026-11-06T10:00:00').toISOString(),
    );
  });
  it('24x7 is wall-clock', () => {
    expect(
      addBusinessMinutes(ist('2026-11-08T22:00:00'), 15, TWENTY_FOUR_SEVEN).toISOString(),
    ).toBe(ist('2026-11-08T22:15:00').toISOString());
  });
  it('works across a DST change for non-IST zones', () => {
    const ny: BusinessCalendar = {
      timeZone: 'America/New_York',
      weekly: { fri: [['09:00', '17:00']], mon: [['09:00', '17:00']] },
    };
    // US DST ends Sun 2026-11-01. Fri Oct 30 16:00 EDT + 2h -> Mon Nov 2 10:00 EST (15:00Z)
    expect(addBusinessMinutes(new Date('2026-10-30T20:00:00Z'), 120, ny).toISOString()).toBe(
      '2026-11-02T15:00:00.000Z',
    );
  });
  it('rejects a calendar with no open time', () => {
    expect(() => addBusinessMinutes(new Date(), 10, { timeZone: 'UTC', weekly: {} })).toThrow();
  });
});

describe('properties', () => {
  const arbStart = fc.date({
    min: new Date('2026-01-01T00:00:00Z'),
    max: new Date('2027-12-31T00:00:00Z'),
    noInvalidDate: true,
  });
  const arbMin = fc.integer({ min: 0, max: 60 * 24 * 20 });

  it('round-trips: between(start, add(start, n)) == n', () => {
    fc.assert(
      fc.property(arbStart, arbMin, (s, n) => {
        const due = addBusinessMinutes(s, n, IST);
        expect(Math.round(businessMsBetween(s, due, IST) / 60000)).toBe(n);
      }),
      { numRuns: 300 },
    );
  });
  it('is monotonic in minutes', () => {
    fc.assert(
      fc.property(arbStart, arbMin, arbMin, (s, a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(addBusinessMinutes(s, lo, IST).getTime()).toBeLessThanOrEqual(
          addBusinessMinutes(s, hi, IST).getTime(),
        );
      }),
      { numRuns: 300 },
    );
  });
  it('is additive: add(add(s,a),b) == add(s,a+b) for a > 0', () => {
    fc.assert(
      fc.property(
        arbStart,
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        (s, a, b) => {
          expect(addBusinessMinutes(addBusinessMinutes(s, a, IST), b, IST).getTime()).toBe(
            addBusinessMinutes(s, a + b, IST).getTime(),
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('evaluate', () => {
  it('reports elapsed, remaining and breach, excluding paused time', () => {
    const startedAt = ist('2026-11-04T10:00:00');
    const now = ist('2026-11-04T13:00:00');
    const r = evaluate(
      { startedAt, targetMinutes: 240, pausedMs: 60 * 60_000, pausedAt: null, metAt: null },
      IST,
      now,
    );
    expect(r.percentElapsed).toBe(50); // 3h elapsed - 1h paused = 2h of 4h
    expect(r.remainingSeconds).toBe(2 * 3600);
    expect(r.dueAt.toISOString()).toBe(ist('2026-11-04T15:00:00').toISOString());
    expect(r.breached).toBe(false);
  });
  it('freezes while paused', () => {
    const r = evaluate(
      {
        startedAt: ist('2026-11-04T10:00:00'),
        targetMinutes: 60,
        pausedMs: 0,
        pausedAt: ist('2026-11-04T10:30:00'),
        metAt: null,
      },
      IST,
      ist('2026-11-04T16:00:00'),
    );
    expect(r.percentElapsed).toBe(50);
    expect(r.breached).toBe(false);
  });
  it('minutes helper floors', () => {
    expect(
      businessMinutesBetween(ist('2026-11-04T10:00:00'), ist('2026-11-04T10:00:59'), IST),
    ).toBe(0);
  });
});

describe('crossedThreshold', () => {
  it('returns the highest newly crossed threshold', () => {
    expect(crossedThreshold(80, 0)).toBe(75);
    expect(crossedThreshold(80, 75)).toBeNull();
    expect(crossedThreshold(120, 75)).toBe(100);
  });
});
