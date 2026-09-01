/* Google Calendar links.

   A deadline is an instant, not a day, and the whole point of this site is that
   AoE is not your timezone. So the event is built in UTC (the Z form Google
   treats as absolute) rather than as an all-day event, which Google would place
   in the viewer's local day and quietly move the deadline. */

export const HOME = 'https://kritshekhar.github.io/WhiteRabbit/';
export const REPO = 'https://github.com/Kritshekhar/WhiteRabbit';

/* Every event carries where it came from. A calendar entry outlives the tab it
   was created in, so the reader needs a way back to the source - to re-check a
   date that was only an estimate, or to report one that is wrong. */
export function eventDetails(lines) {
  return [
    ...lines.filter(Boolean),
    '',
    `White Rabbit: ${HOME}`,
    `Source and corrections: ${REPO}`,
  ].join('\n');
}

const pad = (n) => String(n).padStart(2, '0');

const stamp = (date) =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
  `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

/* A 30-minute block ending on the deadline: it lands in the calendar as the
   last half hour you have, which is more useful than a zero-length marker. */
export function googleCalendarUrl({ title, iso, details = '', location = '', minutes = 30 }) {
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

export function calendarButton({ title, iso, details, location }) {
  const href = googleCalendarUrl({ title, iso, details, location });
  if (!href) return '';
  return `<a class="icon-action" href="${href}" target="_blank" rel="noopener"
     title="Add to Google Calendar" aria-label="Add ${title} to Google Calendar"
     onclick="event.stopPropagation()">
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>
    </svg></a>`;
}
