/* Google Calendar links, ported from assets/lib/calendar.js.

   A deadline is an instant, not a day, and the whole point of this site is that
   AoE is not your timezone. So the event is built in UTC (the Z form Google
   treats as absolute) rather than as an all-day event, which Google would place
   in the viewer's local day and quietly move the deadline. */

import type { Grant, Venue } from './types';
import type { Round } from './dates';

export const HOME = 'https://kritshekhar.github.io/WhiteRabbit/';
export const REPO = 'https://github.com/Kritshekhar/WhiteRabbit';

/* Every event carries where it came from. A calendar entry outlives the tab it
   was created in, so the reader needs a way back to the source. */
export function eventDetails(lines: string[]): string {
  return [...lines.filter(Boolean), '', `White Rabbit: ${HOME}`, `Source and corrections: ${REPO}`].join('\n');
}

const pad = (n: number) => String(n).padStart(2, '0');

const stamp = (date: Date) =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
  `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

export interface CalendarEvent {
  title: string;
  iso: string;
  details?: string;
  location?: string;
  minutes?: number;
}

/* A 30-minute block ending on the deadline: it lands in the calendar as the
   last half hour you have, which is more useful than a zero-length marker. */
export function googleCalendarUrl({ title, iso, details = '', location = '', minutes = 30 }: CalendarEvent): string {
  const end = new Date(Date.parse(iso));
  if (Number.isNaN(end.getTime())) return '';
  const start = new Date(end.getTime() - minutes * 60000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${stamp(start)}/${stamp(end)}`,
    details,
    location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/* The event for one round of a venue. The list wording ("not yet confirmed on
   the CFP page") and the detail wording ("estimated") match the old pages. */
export function venueEvent(v: Pick<Venue, 'name' | 'full_name' | 'year' | 'url'>, r: Round, fromList = false): CalendarEvent {
  return {
    title: `${v.name} ${v.year || ''} - ${r.name}`.replace(/\s+/g, ' ').trim(),
    iso: r.date as string,
    details: eventDetails([
      v.full_name || v.name,
      '',
      `${r.name} deadline${r.confirmed ? '' : fromList ? ' (estimated - not yet confirmed on the CFP page)' : ' (estimated)'}.`,
      v.url ? `${fromList ? 'Call for papers' : 'Official page'}: ${v.url}` : '',
    ]),
    location: v.url,
  };
}

export function grantEvent(g: Pick<Grant, 'name' | 'funder' | 'amount' | 'url'>, r: Round, fromList = false): CalendarEvent {
  if (!fromList) {
    return {
      title: `${g.name} - ${r.name}`,
      iso: r.date as string,
      details: eventDetails([g.name, '', `${r.name} deadline${r.confirmed ? '' : ' (estimated)'}.`,
        g.url ? `Official page: ${g.url}` : '']),
      location: g.url,
    };
  }
  return {
    title: `${g.name} - ${r.name}`,
    iso: r.date as string,
    details: eventDetails([
      g.name,
      g.funder ? `Funder: ${g.funder}` : '',
      g.amount ? `Award: ${g.amount}` : '',
      '',
      `${r.name} deadline${r.confirmed ? '' : ' (estimated - not yet confirmed)'}.`,
      g.url ? `Programme page: ${g.url}` : '',
    ]),
    location: g.url,
  };
}
