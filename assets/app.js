/* Conference deadline dashboard.
   Reads data/deadlines.json (generated from conferences.yml by scripts/update.py).
   Countdowns are computed in the browser, so the numbers stay right between
   nightly rebuilds - and any venue added to the config just shows up here. */

const DAY = 86400000;
const TIERS = { tier1: 'Tier-1', companion: 'Companion', workshop: 'Workshop' };
const TIER_ORDER = { tier1: 0, companion: 1, workshop: 2 };

/* Urgency bands. `color` is a status token; `label` is the text that always
   ships beside it, so the state never depends on colour alone. */
const BANDS = [
  { max: 7,   color: 'var(--critical)', label: 'Due this week' },
  { max: 21,  color: 'var(--serious)',  label: 'Due this month' },
  { max: 60,  color: 'var(--warning)',  label: 'Approaching' },
  { max: Infinity, color: 'var(--good)', label: 'On the horizon' },
];

const state = { venues: [], tier: 'all', query: '', onlyUpcoming: true, sort: 'deadline' };
const $ = (id) => document.getElementById(id);

/* ----------------------------- derivation ------------------------------- */
/* A deadline's calendar date is the one in ITS OWN timezone, not the viewer's
   and not UTC. 2026-09-17T23:59-12:00 is Sep 18 11:59 UTC - printing that in
   UTC shows the wrong day, which on a deadline tracker is the worst kind of
   wrong. Pull the offset out of the ISO string and read the date at it. */
function offsetMinutes(iso) {
  if (!iso) return 0;
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  if (!m) return 0;                       // trailing Z, or no offset
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function decorate(venue, now) {
  const rounds = (venue.deadlines || [])
    .map((d) => ({ ...d, ts: d.date ? Date.parse(d.date) : null, off: offsetMinutes(d.date) }))
    .sort((a, b) => (a.ts ?? Infinity) - (b.ts ?? Infinity));

  const next = rounds.find((r) => r.ts && r.ts > now) || null;
  const hasDates = rounds.some((r) => r.ts);

  let status = 'tba';
  if (venue.rolling) status = 'rolling';
  else if (next) status = 'upcoming';
  else if (hasDates) status = 'passed';

  const days = next ? Math.ceil((next.ts - now) / DAY) : null;
  const band = days === null ? null : BANDS.find((b) => days <= b.max);

  return { ...venue, rounds, next, status, days, band };
}

/* ------------------------------ formatting ------------------------------ */
const fmtDate = (ts, offMin = 0) =>
  new Date(ts + offMin * 60000).toLocaleDateString(undefined,
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function countdownMarkup(v) {
  if (v.status === 'rolling') return '<p class="countdown-flat">Rolling submission</p>';
  if (v.status === 'passed') return '<p class="countdown-flat">Cycle closed — awaiting next CFP</p>';
  if (v.status === 'tba') return '<p class="countdown-flat">Deadline TBA</p>';
  const unit = v.days === 1 ? 'day left' : 'days left';
  return `<div class="countdown"><span class="countdown-num">${v.days}</span><span class="countdown-unit">${unit} · ${v.band.label}</span></div>`;
}

function card(v) {
  const statusVar = v.band ? v.band.color : 'var(--border-strong)';
  const est = !v.next ? ''
    : v.next.confirmed
      ? ' <span class="badge badge-ok">✓ verified</span>'
      : ' <span class="badge badge-est">est.</span>';
  const tierClass = v.tier === 'tier1' ? 'badge badge-tier1' : 'badge';

  // date + badge share a nowrap span so the line breaks before the date, not
  // between the date and its "est." marker
  const track = (d) => (d.track ? `<span class="tag tag-track">${d.track}</span> ` : '');
  const line = v.next
    ? `<p class="deadline-line">${track(v.next)}<strong>${v.next.name}</strong> · <span class="nowrap">${fmtDate(v.next.ts, v.next.off)} AoE${est}</span></p>`
    : '';

  // Runway meter: full at 180 days out, empty at the deadline.
  const meter = v.days === null ? ''
    : `<div class="meter" role="img" aria-label="${v.days} days remaining"><span style="width:${Math.max(3, Math.min(100, 100 - (v.days / 180) * 100)).toFixed(0)}%"></span></div>`;

  const others = v.rounds
    .filter((r) => r.ts && r !== v.next)
    .map((r) => `<div class="${r.ts < Date.now() ? 'past' : ''}"><span>${track(r)}${r.name}</span><span>${fmtDate(r.ts, r.off)}${r.confirmed ? '' : ' · est.'}</span></div>`)
    .join('');

  const link = v.url
    ? `<a class="card-link" href="${v.url}" target="_blank" rel="noopener">Visit site ↗</a>`
    : '<span class="link-state">No site yet</span>';
  const dot = { ok: 'dot dot-ok', dead: 'dot dot-dead' }[v.link_status] || 'dot';
  const LINK_TEXT = {
    ok:   ['site up', 'The nightly build requested this URL and it responded.'],
    dead: ['link broken', 'This URL returned 404/410 on the last nightly build - the venue probably moved it.'],
  };
  const [linkLabel, linkHelp] = LINK_TEXT[v.link_status]
    || ['not checked', 'No response either way on the last build (timeout, or the host blocked the request).'];

  return `
  <article class="card" style="--status:${statusVar}">
    <div class="card-head">
      <div>
        <h3 class="card-name">${v.name}</h3>
        ${v.full_name ? `<p class="card-full">${v.full_name}</p>` : ''}
      </div>
      <div class="pills">
        <span class="${tierClass}">${TIERS[v.tier] || v.tier}</span>
        ${v.year ? `<span class="badge badge-year">${v.year}</span>` : ''}
      </div>
    </div>
    <div>${countdownMarkup(v)}${line}</div>
    ${meter}
    ${others ? `<div class="rounds">${others}</div>` : ''}
    ${v.formats.length ? `<div class="tags"><span class="tags-label">Accepts</span>${v.formats.map((f) => `<span class="tag">${f}</span>`).join('')}</div>` : ''}
    ${v.tracks.length ? `<div class="tags"><span class="tags-label">Tracks</span>${v.tracks.map((t) => `<span class="tag tag-track">${t}</span>`).join('')}</div>` : ''}
    ${v.notes ? `<p class="note">${v.notes}</p>` : ''}
    <div class="card-foot">
      ${link}
      <span class="link-state" title="${linkHelp}"><span class="${dot}"></span>${linkLabel}</span>
    </div>
  </article>`;
}

/* ------------------------------- rendering ------------------------------ */
function visible() {
  const q = state.query.trim().toLowerCase();
  return state.venues.filter((v) => {
    if (state.tier !== 'all' && v.tier !== state.tier) return false;
    if (state.onlyUpcoming && (v.status === 'passed')) return false;
    if (!q) return true;
    return `${v.name} ${v.full_name} ${v.notes}`.toLowerCase().includes(q);
  });
}

function sorted(list) {
  const copy = [...list];
  if (state.sort === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name));
  if (state.sort === 'tier') {
    return copy.sort((a, b) => (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) || (a.days ?? Infinity) - (b.days ?? Infinity));
  }
  return copy.sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity) || a.name.localeCompare(b.name));
}

function render() {
  const list = sorted(visible());
  $('grid').innerHTML = list.map(card).join('');
  $('empty').hidden = list.length > 0;
  $('result-count').textContent = `${list.length} of ${state.venues.length} venues`;
}

function renderStats(meta) {
  const upcoming = state.venues.filter((v) => v.status === 'upcoming').sort((a, b) => a.days - b.days);
  const head = upcoming[0];
  $('stat-next-label').textContent = head && head.days <= 7 ? "I'm late! I'm late!" : 'Next up';
  $('stat-next-venue').textContent = head ? `${head.name} · ${head.days}d` : '—';
  $('stat-next-detail').textContent = head
    ? `${head.next.name} · ${fmtDate(head.next.ts, head.next.off)} AoE${head.next.confirmed ? '' : ' (est.)'}`
    : 'nothing scheduled';
  $('stat-soon').textContent = upcoming.filter((v) => v.days <= 30).length;
  $('stat-quarter').textContent = upcoming.filter((v) => v.days <= 90).length;
  $('stat-total').textContent = meta.counts.total;
  $('stat-breakdown').textContent = `${meta.counts.tier1} tier-1 · ${meta.counts.companion} companion · ${meta.counts.workshop} workshop`;
  const verified = upcoming.filter((v) => v.next.confirmed).length;
  $('verified-note').textContent =
    `${verified} of ${upcoming.length} upcoming deadlines have been checked against the venue's own CFP page; the rest are extrapolated from previous cycles.`;
  $('updated').textContent = `updated ${new Date(meta.generated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

/* -------------------------------- theme --------------------------------- */
(function theme() {
  const saved = localStorage.getItem('cd-theme');
  if (saved) document.documentElement.dataset.theme = saved;
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#theme-toggle')) return;
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    localStorage.setItem('cd-theme', root.dataset.theme);
  });
})();

/* --------------------------------- wiring ------------------------------- */
$('search').addEventListener('input', (e) => { state.query = e.target.value; render(); });
$('hide-passed').addEventListener('change', (e) => { state.onlyUpcoming = e.target.checked; render(); });
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
$('tier-filter').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('#tier-filter .chip').forEach((c) => c.classList.toggle('is-active', c === chip));
  state.tier = chip.dataset.tier;
  render();
});

fetch('data/deadlines.json', { cache: 'no-cache' })
  .then((r) => r.json())
  .then((data) => {
    const now = Date.now();
    state.venues = data.venues.map((v) => decorate(v, now));
    renderStats(data);
    render();
  })
  .catch((err) => {
    console.error(err);
    $('updated').textContent = 'could not load data/deadlines.json';
    $('empty').hidden = false;
    $('empty').textContent = 'Failed to load deadline data.';
  });
