/* Funding page. Reads data/grants.json, built from grants.yml by
   scripts/update_grants.py. Countdowns are computed here, not stored, so the
   day counts stay correct between nightly rebuilds. */

import { decorate, fmtDate, firstSentence } from './lib/dates.js?v=5662d57c';
import { $, initTheme, initChips, initMultiSelect, initRowNav } from './lib/ui.js?v=510137a5';
import { row } from './lib/row.js?v=45a9ced5';
import { eventDetails } from './lib/calendar.js?v=23596919';

const WHO_SLOT = {
  'PhD student': 'top',
  'Postdoc': 'mid',
  'Early-career faculty': 'mid',
  'Faculty / PI': 'base',
};
const BANDS = [
  { max: 14, color: 'var(--critical)', label: 'Closing this fortnight' },
  { max: 45, color: 'var(--serious)', label: 'Closing soon' },
  { max: 120, color: 'var(--warning)', label: 'Approaching' },
  { max: Infinity, color: 'var(--good)', label: 'On the horizon' },
];

/* One dataset, two pages. The page declares who it is for on <body>, because
   a PhD fellowship and a $1M PI grant are different things with different
   readers - putting them behind a filter on one page buried both. */
const AUDIENCE = document.body.dataset.audience || 'faculty';
const AUDIENCE_ELIGIBILITY = {
  student: ['PhD student'],
  faculty: ['Faculty / PI', 'Early-career faculty', 'Postdoc'],
};
// Government money and industry money have different rules and timelines.
const GOVERNMENT = /^(NSF|DOE|DoD|DARPA|ONR|AFOSR|Army|NASA|NIH)/i;

const state = { grants: [], who: 'all', kind: 'all', funders: new Set(), query: '', onlyOpen: true, datedOnly: false, sort: 'deadline' };


function countdown(g) {
  if (g.status === 'closed') return '<p class="countdown-flat">Closed - awaiting the next call</p>';
  if (g.status === 'tba' || g.days === null || !g.band) return '<p class="countdown-flat">Deadline not announced</p>';
  const unit = g.days === 1 ? 'day left' : 'days left';
  return `<div class="countdown"><span class="countdown-num">${g.days}</span><span class="countdown-unit">${unit} · ${g.band.label}</span></div>`;
}

function grantRow(g) {
  const tags = [
    g.funder ? `<span class="tag tag-pub">${g.funder}</span>` : '',
    ...g.topics.slice(0, 2).map((t) => `<span class="tag">${t}</span>`),
    `<span class="badge badge-rank rank-${WHO_SLOT[g.eligibility] || 'base'}">${g.eligibility}</span>`,
  ].filter(Boolean);

  const statusText = g.status === 'closed'
    ? 'Closed - awaiting the next call'
    : 'Deadline not announced';

  return row({
    id: g.id,
    href: `venue.html?type=grant&id=${encodeURIComponent(g.id)}`,
    title: g.name,
    /* Not `notes`: every federal record carries the same "due 5 p.m. local
       time" rule, so falling back to it printed one identical line on 33 rows.
       The award or the opportunity number actually distinguishes them. */
    subtitle: g.amount || (g.opportunity_number ? `Opportunity ${g.opportunity_number}` : ''),
    tags,
    deadline: g.next,
    days: g.days,
    band: g.band,
    statusText,
    url: g.url,
    calendar: g.next ? {
      title: `${g.name} - ${g.next.name}`,
      iso: g.next.date,
      details: eventDetails([
        g.name,
        g.funder ? `Funder: ${g.funder}` : '',
        g.amount ? `Award: ${g.amount}` : '',
        '',
        `${g.next.name} deadline${g.next.confirmed ? '' : ' (estimated - not yet confirmed)'}.`,
        g.url ? `Programme page: ${g.url}` : '',
      ]),
      location: g.url,
    } : null,
  });
}

function visible() {
  const q = state.query.trim().toLowerCase();
  return state.grants.filter((g) => {
    if (state.who !== 'all' && g.eligibility !== state.who) return false;
    if (state.kind !== 'all') {
      const isGov = GOVERNMENT.test(g.funder);
      if (state.kind === 'government' && !isGov) return false;
      if (state.kind === 'industry' && isGov) return false;
    }
    if (state.funders.size && !state.funders.has(g.funder)) return false;
    if (state.onlyOpen && g.status === 'closed') return false;
    if (state.datedOnly && g.status !== 'open') return false;
    if (!q) return true;
    return `${g.name} ${g.funder} ${g.notes} ${g.topics.join(' ')} ${g.eligibility}`.toLowerCase().includes(q);
  });
}

function render() {
  const list = [...visible()].sort(state.sort === 'name'
    ? (a, b) => a.name.localeCompare(b.name)
    : (a, b) => (a.days ?? Infinity) - (b.days ?? Infinity) || a.name.localeCompare(b.name));
  $('grid').innerHTML = list.map(grantRow).join('');
  $('empty').hidden = list.length > 0;
  $('result-count').textContent = `${list.length} of ${state.grants.length} programmes`;
}

function renderStats(meta) {
  const open = state.grants.filter((g) => g.status === 'open').sort((a, b) => a.days - b.days);
  const undated = state.grants.filter((g) => g.status === 'tba').length;
  const confirmed = state.grants.filter((g) => g.deadlines.some((d) => d.confirmed)).length;
  const head = open[0];

  if (head) {
    $('stat-next-label').textContent = head.days <= 14 ? "I'm late! I'm late!" : 'Next up';
    $('stat-next-name').textContent = `${head.name.slice(0, 34)}${head.name.length > 34 ? '…' : ''}`;
    $('stat-next-detail').textContent = `${head.funder} · ${head.days}d · ${fmtDate(head.next.ts, head.next.off)}`;
  } else {
    // Nothing dated. An em dash here reads as broken, so say what is true.
    const funders = new Set(state.grants.map((g) => g.funder).filter(Boolean));
    $('stat-next-label').textContent = 'Nothing dated yet';
    $('stat-next-name').textContent = `${state.grants.length} programmes`;
    $('stat-next-detail').textContent =
      `across ${funders.size} funders · none has published its next deadline`;
  }

  $('stat-open').textContent = AUDIENCE === 'student' ? state.grants.length : open.length;
  $('stat-soon').textContent = open.length ? open.filter((g) => g.days <= 60).length : undated;
  const soonNote = document.querySelector('#stat-soon + .tile-note');
  if (soonNote) {
    soonNote.textContent = open.length ? 'across all funders' : 'awaiting a published date';
  }
  const soonLabel = document.querySelector('#stat-soon')?.previousElementSibling;
  if (soonLabel && !open.length) soonLabel.textContent = 'Dates not announced';

  $('stat-total').textContent = AUDIENCE === 'student' ? confirmed : state.grants.length;
  $('stat-breakdown').textContent = AUDIENCE === 'student'
    ? `of ${state.grants.length} tracked`
    : `${confirmed} with a confirmed date`;
  $('updated').textContent = new Date(meta.generated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  const verified = open.filter((g) => g.next.confirmed).length;
  $('verified-note').textContent = open.length
    ? `${verified} of ${open.length} open deadlines have been checked against the funder's own record.`
    : `None of these ${state.grants.length} programmes has published its next deadline. Each card links to the programme page - check there before planning.`;
}

$('search').addEventListener('input', (e) => { state.query = e.target.value; render(); });
$('hide-passed').addEventListener('change', (e) => { state.onlyOpen = e.target.checked; render(); });
const datedBox = $('dated-only');
if (datedBox) datedBox.addEventListener('change', (e) => { state.datedOnly = e.target.checked; render(); });
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

fetch('data/grants.json', { cache: 'no-cache' })
  .then((r) => r.json())
  .then((d) => {
    const now = Date.now();
    const wanted = AUDIENCE_ELIGIBILITY[AUDIENCE] || [];
    state.grants = d.grants
      .filter((g) => wanted.includes(g.eligibility))
      .map((g) => ({ ...decorate(g, now, BANDS), status: '' }))
      .map((g) => ({ ...g, status: g.next ? 'open' : (g.hasDates ? 'closed' : 'tba') }));

    const counts = new Map();
    state.grants.forEach((g) => g.funder && counts.set(g.funder, (counts.get(g.funder) || 0) + 1));
    initMultiSelect({
      menu: $('funder-menu'), list: $('funder-list'), clear: $('funder-clear'),
      summary: $('funder-summary'), label: 'Funders', counts,
      onChange: (chosen) => { state.funders = chosen; render(); },
    });
    initChips($('who-filter'), AUDIENCE === 'student' ? 'kind' : 'who',
      (v) => { if (AUDIENCE === 'student') state.kind = v; else state.who = v; render(); });
    initTheme();
    initRowNav($('grid'));
    renderStats(d);
    render();
  })
  .catch((err) => {
    console.error(err);
    $('updated').textContent = 'could not load data/grants.json';
    $('empty').hidden = false;
    $('empty').textContent = 'Failed to load funding data.';
  });
