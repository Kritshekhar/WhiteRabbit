/* Detail view for one venue or one funding programme.

   One page, not 99 generated files: it reads the same JSON the listings use and
   renders whichever record the query string names. That keeps every detail
   deep-linkable and shareable without a build step producing a file per venue. */

import { decorate, fmtDate } from './lib/dates.js?v=5662d57c';
import { provenanceBadge } from './lib/card.js?v=fe03174b';
import { calendarButton, googleCalendarUrl, eventDetails } from './lib/calendar.js?v=23596919';
import { $, initTheme } from './lib/ui.js?v=510137a5';

const BANDS = [
  { max: 7, color: 'var(--critical)', label: 'Due this week' },
  { max: 21, color: 'var(--serious)', label: 'Due this month' },
  { max: 60, color: 'var(--warning)', label: 'Approaching' },
  { max: Infinity, color: 'var(--good)', label: 'On the horizon' },
];
const TIERS = {
  'rabbit-hole': 'Rabbit Hole', 'royal-flush': 'Royal Flush',
  'full-house': 'Full House', 'looking-glass': 'Looking Glass',
};
const RANK_SLOT = { 'rabbit-hole': 'base', 'royal-flush': 'top', 'full-house': 'mid', 'looking-glass': 'off' };

initTheme();

const params = new URLSearchParams(location.search);
const wantedId = params.get('id');
const source = params.get('type') === 'grant' ? 'data/grants.json' : 'data/deadlines.json';
const collection = params.get('type') === 'grant' ? 'grants' : 'venues';

function tagRow(v) {
  return [
    v.publisher ? `<span class="tag tag-pub">${v.publisher}</span>` : '',
    v.funder ? `<span class="tag tag-pub">${v.funder}</span>` : '',
    ...(v.topics || []).map((t) => `<span class="tag">${t}</span>`),
    v.tier ? `<span class="badge badge-rank rank-${RANK_SLOT[v.tier] || 'off'}">${TIERS[v.tier] || v.tier}</span>` : '',
    v.eligibility ? `<span class="badge badge-rank rank-top">${v.eligibility}</span>` : '',
  ].filter(Boolean).join('');
}

function render(v) {
  document.title = `${v.name} · White Rabbit`;
  $('crumb-name').textContent = v.name;

  const status = v.band ? v.band.color : 'var(--border-strong)';
  const hero = v.next
    ? `<div class="countdown"><span class="countdown-num">${v.days}</span></div>
       <div><p class="deadline-line"><strong>${v.next.name}</strong> · ${fmtDate(v.next.ts, v.next.off)}${provenanceBadge(v.next)}</p>
       <p class="note">${v.band.label}${v.next.date.endsWith('-12:00') ? ' · deadline is AoE (UTC-12)' : ''}</p></div>`
    : `<p class="countdown-flat">${v.rolling ? 'Rolling submission - no deadline' : (v.hasDates ? 'Cycle closed - awaiting the next call' : 'Deadline not announced')}</p>`;

  const rounds = v.rounds.filter((r) => r.ts).map((r) => `
    <div class="${r.ts < Date.now() ? 'past' : ''}">
      <span>${r.track ? `<span class="tag tag-track">${r.track}</span> ` : ''}${r.name}</span>
      <span class="nowrap">${fmtDate(r.ts, r.off)}${provenanceBadge(r)}
        ${r.ts > Date.now() ? calendarButton({
          title: `${v.name} ${v.year || ''} - ${r.name}`.replace(/\s+/g, ' ').trim(),
          iso: r.date,
          details: eventDetails([v.full_name || v.name, '',
            `${r.name} deadline${r.confirmed ? '' : ' (estimated)'}.`,
            v.url ? `Official page: ${v.url}` : '']),
          location: v.url,
        }) : ''}</span>
    </div>`).join('');

  const section = (title, body) => body
    ? `<section class="detail-section"><h3>${title}</h3>${body}</section>` : '';

  $('detail').innerHTML = `
    <div class="detail-head"><h2>${v.name}</h2></div>
    ${v.full_name ? `<p class="detail-sub">${v.full_name}</p>` : ''}
    <div class="tags" style="margin-bottom:1rem">${tagRow(v)}</div>
    <div class="detail-hero" style="--status:${status}">${hero}</div>

    ${section('All deadlines', rounds ? `<div class="detail-table">${rounds}</div>` : '')}
    ${section('Accepts', (v.formats || []).map((f) => `<span class="tag">${f}</span>`).join(' '))}
    ${section('Tracks', (v.tracks || []).map((t) => `<span class="tag tag-track">${t}</span>`).join(' '))}
    ${section('Award', v.amount ? `<p class="deadline-line">${v.amount}</p>` : '')}
    ${section('Notes', v.notes ? `<p class="note">${v.notes}</p>` : '')}
    ${section('Record', `<div class="detail-table">
        ${v.year ? `<div><span>Edition</span><span>${v.year}</span></div>` : ''}
        ${v.opportunity_number ? `<div><span>Opportunity number</span><span>${v.opportunity_number}</span></div>` : ''}
        ${v.link_status ? `<div><span>Link check</span><span>${v.link_status}</span></div>` : ''}
        ${v.next && v.next.source ? `<div><span>Date source</span><span><a class="card-link" href="${v.next.source}" target="_blank" rel="noopener">solicitation ↗</a></span></div>` : ''}
      </div>`)}

    <div class="detail-actions">
      ${v.url ? `<a class="btn btn-primary" href="${v.url}" target="_blank" rel="noopener">Official page ↗</a>` : ''}
      ${v.next ? `<a class="btn" href="${googleCalendarUrl({
        title: `${v.name} ${v.year || ''} - ${v.next.name}`.replace(/\s+/g, ' ').trim(),
        iso: v.next.date,
        details: eventDetails([v.full_name || v.name, '',
          `${v.next.name} deadline${v.next.confirmed ? '' : ' (estimated)'}.`,
          v.url ? `Official page: ${v.url}` : '']),
        location: v.url,
      })}" target="_blank" rel="noopener">Add to Google Calendar</a>` : ''}
      <a class="btn" href="${collection === 'grants' ? 'grants.html' : 'index.html'}">Back to the list</a>
    </div>`;
}

fetch(source, { cache: 'no-cache' })
  .then((r) => r.json())
  .then((data) => {
    const now = Date.now();
    const raw = (data[collection] || []).find((x) => x.id === wantedId);
    if (!raw) {
      $('detail').innerHTML = `<p class="empty">No record found for <code>${wantedId || '(none)'}</code>.
        <a class="card-link" href="index.html">Back to the list</a></p>`;
      return;
    }
    render(decorate(raw, now, BANDS));
  })
  .catch(() => {
    $('detail').innerHTML = '<p class="empty">Could not load the data file.</p>';
  });
