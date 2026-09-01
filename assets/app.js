/* Conference deadline dashboard.
   Reads data/deadlines.json (generated from conferences.yml by scripts/update.py).
   Countdowns are computed in the browser, so the numbers stay right between
   nightly rebuilds - and any venue added to the config just shows up here. */

import { decorate, fmtDate } from './lib/dates.js?v=5662d57c';
import { row } from './lib/row.js?v=45a9ced5';
import { eventDetails } from './lib/calendar.js?v=23596919';
import { $, initTheme, initChips, initMultiSelect, initRowNav } from './lib/ui.js?v=510137a5';

/* Not a ranking - a project's path: workshop, then full paper, then journal.
   Stage 2 is the only one with grades. journey.html explains it.
   RANK_SLOT maps a rank to a colour slot so the CSS never knows the names. */
const TIERS = {
  'rabbit-hole': 'Rabbit Hole',
  'royal-flush': 'Royal Flush',
  'full-house': 'Full House',
  'looking-glass': 'Looking Glass',
};
const RANK_SLOT = { 'rabbit-hole': 'base', 'royal-flush': 'top', 'full-house': 'mid', 'looking-glass': 'off' };

/* Urgency bands. `color` is a status token; `label` is the text that always
   ships beside it, so the state never depends on colour alone. */
const BANDS = [
  { max: 7,   color: 'var(--critical)', label: 'Due this week' },
  { max: 21,  color: 'var(--serious)',  label: 'Due this month' },
  { max: 60,  color: 'var(--warning)',  label: 'Approaching' },
  { max: Infinity, color: 'var(--good)', label: 'On the horizon' },
];

const state = { venues: [], tier: 'all', topics: new Set(), query: '', onlyUpcoming: true, sort: 'deadline' };

function venueRow(v) {
  const tags = [
    v.publisher ? `<span class="tag tag-pub">${v.publisher}</span>` : '',
    ...v.topics.slice(0, 2).map((t) => `<span class="tag">${t}</span>`),
    `<span class="badge badge-rank rank-${RANK_SLOT[v.tier] || 'off'}">${TIERS[v.tier] || v.tier}</span>`,
  ].filter(Boolean);

  const statusText = v.rolling ? 'Rolling submission'
    : v.status === 'passed' ? 'Cycle closed'
    : 'Deadline TBA';

  return row({
    id: v.id,
    href: `venue.html?id=${encodeURIComponent(v.id)}`,
    title: v.name,
    subtitle: v.full_name,
    tags,
    deadline: v.next,
    days: v.days,
    band: v.band,
    statusText,
    url: v.url,
    calendar: v.next ? {
      title: `${v.name} ${v.year || ''} - ${v.next.name}`.replace(/\s+/g, ' ').trim(),
      iso: v.next.date,
      details: eventDetails([
        v.full_name || v.name,
        '',
        `${v.next.name} deadline${v.next.confirmed ? '' : ' (estimated - not yet confirmed on the CFP page)'}.`,
        v.url ? `Call for papers: ${v.url}` : '',
      ]),
      location: v.url,
    } : null,
  });
}

function visible() {
  const q = state.query.trim().toLowerCase();
  return state.venues.filter((v) => {
    if (state.tier !== 'all' && v.tier !== state.tier) return false;
    if (state.topics.size && !v.topics.some((t) => state.topics.has(t))) return false;
    if (state.onlyUpcoming && (v.status === 'passed')) return false;
    if (!q) return true;
    return `${v.name} ${v.full_name} ${v.notes} ${v.topics.join(' ')}`.toLowerCase().includes(q);
  });
}

function sorted(list) {
  const copy = [...list];
  if (state.sort === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name));
  /* Rolling venues sort to the top, not the bottom. They have no date, but
     "you can submit today" is the most actionable state on the page - sorting
     them with the undated ones buried the only entries that are always open. */
  const rank = (v) => (v.rolling ? -1 : (v.days ?? Infinity));
  return copy.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function render() {
  const list = sorted(visible());
  $('grid').innerHTML = list.map(venueRow).join('');
  $('empty').hidden = list.length > 0;
  $('result-count').textContent = `${list.length} of ${state.venues.length} venues`;
}


function renderStats(meta) {
  const upcoming = state.venues.filter((v) => v.status === 'upcoming').sort((a, b) => a.days - b.days);
  const head = upcoming[0];
  $('stat-next-label').textContent = head && head.days <= 7 ? "I'm late! I'm late!" : 'Next up';
  $('stat-next-venue').textContent = head ? `${head.name} · ${head.days}d` : ' - ';
  $('stat-next-detail').textContent = head
    ? `${head.next.name} · ${fmtDate(head.next.ts, head.next.off)} AoE${head.next.confirmed ? '' : ' (est.)'}`
    : 'nothing scheduled';
  $('stat-soon').textContent = upcoming.filter((v) => v.days <= 30).length;
  $('stat-quarter').textContent = upcoming.filter((v) => v.days <= 90).length;
  $('stat-total').textContent = meta.counts.total;
  const c = meta.counts;
  $('stat-breakdown').textContent =
    `${c['rabbit-hole'] || 0} workshop · ${(c['royal-flush'] || 0) + (c['full-house'] || 0)} full paper · ${c['looking-glass'] || 0} journal`;
  const verified = upcoming.filter((v) => v.next.confirmed).length;
  $('verified-note').textContent =
    `${verified} of ${upcoming.length} upcoming deadlines have been checked against the venue's own CFP page; the rest are extrapolated from previous cycles.`;
  $('updated').textContent = new Date(meta.generated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/* --------------------------------- wiring ------------------------------- */

$('search').addEventListener('input', (e) => { state.query = e.target.value; render(); });
$('hide-passed').addEventListener('change', (e) => { state.onlyUpcoming = e.target.checked; render(); });
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

fetch('data/deadlines.json', { cache: 'no-cache' })
  .then((r) => r.json())
  .then((data) => {
    const now = Date.now();
    /* `status` is venue vocabulary, so it stays here rather than in the shared
       module: a journal is "rolling", a finished cycle is "passed". */
    const statusOf = (v) => {
      if (v.rolling) return 'rolling';
      if (v.next) return 'upcoming';
      return v.hasDates ? 'passed' : 'tba';
    };
    state.venues = data.venues
      .map((v) => decorate(v, now, BANDS))
      .map((v) => ({ ...v, status: statusOf(v) }));

    const counts = new Map();
    state.venues.forEach((v) => v.topics.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    initMultiSelect({
      menu: $('topic-menu'), list: $('topic-list'), clear: $('topic-clear'),
      summary: $('topic-summary'), label: 'Topics', counts,
      onChange: (chosen) => { state.topics = chosen; render(); },
    });
    initChips($('tier-filter'), 'tier', (v) => { state.tier = v; render(); });
    initTheme();
    initRowNav($('grid'));
    renderStats(data);
    render();
  })
  .catch((err) => {
    console.error(err);
    $('updated').textContent = 'could not load data/deadlines.json';
    $('empty').hidden = false;
    $('empty').textContent = 'Failed to load deadline data.';
  });
