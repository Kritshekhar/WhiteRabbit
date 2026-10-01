/* iCalendar (RFC 5545) feeds, so a calendar can subscribe once and keep up as
   dates are verified, corrected or added.

   Each deadline is the same event as the Google link in calendar.ts: a
   30-minute block ending at the deadline instant, in UTC, so an AoE deadline
   is never moved to the viewer's local day. The UID is the database row id,
   which stays put across rebuilds, so a corrected date updates the event the
   subscriber already has instead of adding a second one. */

import { eventDetails, grantEvent, HOME, venueEvent, type CalendarEvent } from './calendar';
import { isAoE, offsetMinutes, type Round } from './dates';
import type { Deadline, Grant, Venue } from './types';

const DOMAIN = 'whiterabbit.kritshekhar.github.io';
const KEEP_PAST_DAYS = 30;

const pad = (n: number) => String(n).padStart(2, '0');
export const icsStamp = (date: Date) =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
  `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

/* TEXT values escape backslash, semicolon, comma and newline (RFC 5545 3.3.11). */
export const escapeText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/* Content lines are folded at 75 octets, continuing with a leading space
   (RFC 5545 3.1). Counted in UTF-8 bytes, never splitting a character. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length ? 74 : 75;   // continuation lines spend one octet on the space
    if (size + n > limit) {
      out.push(cur);
      cur = '';
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export interface IcsEvent extends CalendarEvent {
  uid: string;
  url?: string;
  confirmed: boolean;
}

export function buildCalendar(name: string, description: string, events: IcsEvent[], now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//White Rabbit//Deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-CALDESC:${escapeText(description)}`,
    'X-PUBLISHED-TTL:PT12H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
  ];
  const stamp = icsStamp(now);
  for (const e of events) {
    const end = new Date(Date.parse(e.iso));
    if (Number.isNaN(end.getTime())) continue;
    const start = new Date(end.getTime() - (e.minutes ?? 30) * 60000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@${DOMAIN}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsStamp(start)}`,
      `DTEND:${icsStamp(end)}`,
      `SUMMARY:${escapeText(e.title)}`,
      ...(e.details ? [`DESCRIPTION:${escapeText(e.details)}`] : []),
      ...(e.url ? [`URL:${e.url}`] : []),
      ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
      `STATUS:${e.confirmed ? 'CONFIRMED' : 'TENTATIVE'}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(`${e.title} is due in 7 days`)}`,
      'TRIGGER:-P7D',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/* Deadlines worth putting in a calendar: dated, and not long past. */
function current(deadlines: Deadline[], now: number): Round[] {
  return deadlines
    .filter((d) => d.date && Date.parse(d.date) >= now - KEEP_PAST_DAYS * 86400000)
    .map((d) => ({ ...d, ts: Date.parse(d.date as string), off: 0 }) as unknown as Round);
}

/* The official date goes in the title. A deadline of Dec 1 AoE is Dec 2 in
   most of the world, so the event lands on Dec 2 in the subscriber's calendar;
   the title says which day the venue actually means. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function due(iso: string): string {
  const local = new Date(Date.parse(iso) + offsetMinutes(iso) * 60000);
  const day = `${MONTHS[local.getUTCMonth()]} ${local.getUTCDate()}`;
  if (isAoE(iso)) return `${day} AoE`;
  const off = offsetMinutes(iso);
  if (!off) return `${day} UTC`;
  const h = Math.trunc(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  return `${day} UTC${off < 0 ? '-' : '+'}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

function titled(title: string, iso: string, confirmed: boolean): string {
  // only the separator before the round name; a grant name can contain " - " itself
  const at = title.lastIndexOf(' - ');
  const base = at < 0 ? title : `${title.slice(0, at)} · ${title.slice(at + 3)}`;
  return `${base} (due ${due(iso)}${confirmed ? '' : ', est.'})`;
}

export function venueIcsEvents(v: Venue, now = Date.now()): IcsEvent[] {
  return current(v.deadlines, now).map((r) => {
    const e = venueEvent(v, r);
    return { ...e, title: titled(e.title, e.iso, r.confirmed), uid: `deadline-${(r as unknown as Deadline).id ?? `${v.id}-${r.name}`}`,
      url: `${HOME}conferences/${v.id}/`, confirmed: r.confirmed };
  });
}

export function grantIcsEvents(g: Grant, now = Date.now()): IcsEvent[] {
  return current(g.deadlines, now).map((r) => {
    const e = grantEvent(g, r);
    return { ...e, title: titled(e.title, e.iso, r.confirmed), uid: `grant-deadline-${(r as unknown as Deadline).id ?? `${g.id}-${r.name}`}`,
      url: `${HOME}grants/${g.id}/`, confirmed: r.confirmed };
  });
}

/* Events for any record with a name and deadlines (the home page's entries),
   for the starred-deadlines download. */
export function entryIcsEvents(e: { kind: 'conference' | 'funding'; name: string; sub: string; href: string; url?: string;
  deadlines: Deadline[] }, now = Date.now()): IcsEvent[] {
  return current(e.deadlines, now).map((r) => {
    const d = r as unknown as Deadline;
    return {
      title: titled(`${e.name} - ${r.name}`, r.date as string, r.confirmed),
      iso: r.date as string,
      details: eventDetails([e.sub || e.name, '', `${r.name} deadline${r.confirmed ? '' : ' (estimated)'}.`,
        e.url ? `Official page: ${e.url}` : '']),
      location: e.url,
      url: new URL(e.href, HOME).toString(),
      uid: `${e.kind === 'conference' ? 'deadline' : 'grant-deadline'}-${d.id ?? `${e.name}-${r.name}`}`,
      confirmed: r.confirmed,
    };
  });
}

export const icsResponse = (body: string) =>
  new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });

/* Save a calendar from the browser, e.g. the starred deadlines, which are
   different for every visitor and so cannot be a static feed. */
export function downloadIcs(filename: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
