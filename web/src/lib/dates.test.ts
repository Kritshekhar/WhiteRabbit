import { describe, expect, it } from 'vitest';
import { decorate, fmtDate, isAoE, offsetMinutes } from './dates';

const BANDS = [{ max: 7, color: 'red', label: 'this week' }, { max: 30, color: 'amber', label: 'this month' }];
const d = (date: string | null, name = 'Paper') => ({ name, date, confirmed: true, source: '', track: '' }) as never;

describe('offsetMinutes', () => {
  it('reads the offset the deadline is written in', () => {
    expect(offsetMinutes('2026-09-17T23:59:00-12:00')).toBe(-720);
    expect(offsetMinutes('2026-09-17T23:59:00+05:30')).toBe(330);
    expect(offsetMinutes('2026-09-17T23:59:00Z')).toBe(0);
    expect(offsetMinutes(null)).toBe(0);
  });
});

describe('fmtDate', () => {
  it('prints the AoE day, not the UTC day it falls on', () => {
    const iso = '2026-09-17T23:59:00-12:00';   // Sep 18 11:59 UTC
    expect(fmtDate(Date.parse(iso), offsetMinutes(iso))).toContain('17');
    expect(isAoE(iso)).toBe(true);
    expect(isAoE('2026-09-17T23:59:00-07:00')).toBe(false);
  });
});

describe('decorate', () => {
  const now = Date.parse('2026-09-10T00:00:00Z');

  it('picks the next future round and its urgency band', () => {
    const r = decorate({ deadlines: [d('2026-09-01T23:59:00-12:00', 'Abstract'), d('2026-09-15T23:59:00-12:00')] }, now, BANDS);
    expect(r.next?.name).toBe('Paper');
    expect(r.days).toBe(7);
    expect(r.band?.label).toBe('this week');
  });

  it('counts days to the AoE instant, so the last day still shows as one day left', () => {
    const r = decorate({ deadlines: [d('2026-09-10T23:59:00-12:00')] }, now, BANDS);
    expect(r.days).toBe(2);   // ends Sep 11 11:59 UTC
  });

  it('has no next round, days or band once everything is past or undated', () => {
    const r = decorate({ deadlines: [d('2026-08-01T23:59:00-12:00'), d(null)] }, now, BANDS);
    expect(r.next).toBeNull();
    expect(r.days).toBeNull();
    expect(r.band).toBeNull();
    expect(r.hasDates).toBe(true);
  });
});
