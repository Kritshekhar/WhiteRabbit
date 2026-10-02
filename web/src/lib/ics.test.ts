import { describe, expect, it } from 'vitest';
import { buildCalendar, escapeText, fold, icsStamp, venueIcsEvents } from './ics';
import type { Venue } from './types';

const unfold = (s: string) => s.replace(/\r\n /g, '');

describe('text and lines', () => {
  it('escapes the characters RFC 5545 reserves', () => {
    expect(escapeText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne');
  });

  it('folds long lines at 75 octets without splitting a character', () => {
    const line = `SUMMARY:${'é'.repeat(60)}`;
    const folded = fold(line);
    const enc = new TextEncoder();
    for (const part of folded.split('\r\n')) expect(enc.encode(part).length).toBeLessThanOrEqual(75);
    expect(unfold(folded)).toBe(line);
  });

  it('writes instants in UTC', () => {
    expect(icsStamp(new Date('2026-09-18T11:59:00Z'))).toBe('20260918T115900Z');
  });
});

describe('buildCalendar', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const ics = buildCalendar('Test', 'Desc', [
    { title: 'FAST 2027 · Paper', iso: '2026-09-17T23:59:00-12:00', uid: 'deadline-1', confirmed: true },
    { title: 'Bad', iso: 'not a date', uid: 'deadline-2', confirmed: false },
  ], now);

  it('is a calendar with CRLF line endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('makes a 30-minute event ending at the AoE instant, with a stable UID', () => {
    const text = unfold(ics);
    expect(text).toContain('DTEND:20260918T115900Z');
    expect(text).toContain('DTSTART:20260918T112900Z');
    expect(text).toContain('UID:deadline-1@');
    expect(text).toContain('STATUS:CONFIRMED');
  });

  it('skips events without a valid date', () => {
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });
});

describe('venueIcsEvents', () => {
  const venue = {
    id: 'fast', name: 'FAST', full_name: 'File and Storage Technologies', year: 2027, url: 'https://example.org',
    deadlines: [
      { id: 7, name: 'Paper submission', date: '2026-09-17T23:59:00-12:00', confirmed: false },
      { id: 8, name: 'Old', date: '2026-01-01T23:59:00-12:00', confirmed: true },
      { id: 9, name: 'Undated', date: null, confirmed: false },
    ],
  } as unknown as Venue;

  it('keeps current dated deadlines, says the official day and marks estimates', () => {
    const events = venueIcsEvents(venue, Date.parse('2026-09-01T00:00:00Z'));
    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('deadline-7');
    expect(events[0].title).toContain('Sep 17 AoE');
    expect(events[0].title).toContain('est.');
    expect(events[0].confirmed).toBe(false);
  });
});
