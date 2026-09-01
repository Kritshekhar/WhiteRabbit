/* One venue or programme per row.

   A row beats a flip card here: the eye scans a column of dates far faster than
   a grid of cards, and everything that mattered on the card front fits on one
   line, so nothing has to be hidden behind a hover. Anything that does not fit
   lives on the detail page rather than a second face. */

import { fmtDate } from './dates.js';
import { provenanceBadge } from './card.js';
import { calendarButton } from './calendar.js';

export function row({ id, href, title, subtitle, tags, deadline, days, band, statusText, url, calendar }) {
  /* The deadline column already spells out the state ("Rolling submission",
     "Cycle closed"), so repeating it here just printed it twice per row. The
     count column is for a number, and stays empty when there is not one. */
  const daysCell = days === null || days === undefined
    ? ''
    : `<span class="row-days" style="color:${band ? band.color : 'var(--text-muted)'}">${days}<small>d</small></span>`;

  const when = deadline
    ? `<span class="row-when"><strong>${deadline.name}</strong> · <span class="nowrap">${fmtDate(deadline.ts, deadline.off)}${provenanceBadge(deadline)}</span></span>`
    : `<span class="row-when row-muted">${statusText || 'No date announced'}</span>`;

  /* A div, not an anchor. The row contains links of its own (the verified
     badge, the calendar and site icons) and nesting <a> inside <a> is invalid:
     the browser closes the outer one and the grid falls apart. initRowNav
     handles click and Enter instead, and the title stays a real link so the
     row is still keyboard-reachable and openable in a new tab. */
  return `
  <div class="row" data-href="${href}" data-id="${id}" tabindex="0"
       style="--status:${band ? band.color : 'var(--border-strong)'}">
    <span class="row-main">
      <a class="row-title" href="${href}">${title}</a>
      ${subtitle ? `<span class="row-sub">${subtitle}</span>` : ''}
    </span>
    <span class="row-tags">${tags.join('')}</span>
    <span class="row-deadline">${when}</span>
    <span class="row-count">${daysCell}</span>
    <span class="row-actions">
      ${calendar ? calendarButton(calendar) : ''}
      ${url ? `<a class="icon-action" href="${url}" target="_blank" rel="noopener"
        title="Open the official page" aria-label="Open the official page"
        onclick="event.stopPropagation()">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>
        </svg></a>` : ''}
    </span>
  </div>`;
}
