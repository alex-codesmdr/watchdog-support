import { describe, expect, it } from 'vitest';
import { caseNumberFromSubject, findReplyToken, stripQuoted } from './parse.js';

describe('inbound email parsing', () => {
  it('finds the reply token', () => {
    expect(findReplyToken(['someone@x.example', 'Case+WD-2026-000123.ab12cd34@support.watchdog.example'], 'case', 'support.watchdog.example')).toBe('wd-2026-000123.ab12cd34');
    expect(findReplyToken(['case+x@evil.example'], 'case', 'support.watchdog.example')).toBeNull();
  });
  it('reads the case number from the subject', () => {
    expect(caseNumberFromSubject('RE: [WD-2026-000123] Link flaps')).toBe('WD-2026-000123');
    expect(caseNumberFromSubject('hello')).toBeNull();
  });
  it('strips quoted history', () => {
    const body = 'Rebooted, still failing.\nLogs attached.\n\nOn Wed, 4 Nov 2026 at 10:00, WatchDog Support wrote:\n> Please reboot\n> thanks';
    expect(stripQuoted(body)).toBe('Rebooted, still failing.\nLogs attached.');
    expect(stripQuoted('Fine now\n\n-----Original Message-----\nFrom: x')).toBe('Fine now');
    expect(stripQuoted('Ok\n-- \nSuresh | IT')).toBe('Ok');
  });
});
