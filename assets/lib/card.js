/* The pieces every card is built from: the flip shell, the provenance badge
   and the link-health footer. Page scripts supply their own faces. */

/* A verified date links to the page it was read off, so any reader can
   re-check it. An estimate says so rather than implying more than we know. */
export function provenanceBadge(deadline) {
  if (!deadline) return '';
  if (!deadline.confirmed) {
    return ' <span class="badge badge-est" title="Extrapolated or second-hand - not checked against the source page">est.</span>';
  }
  const when = deadline.verified_on ? ` on ${deadline.verified_on}` : '';
  return deadline.source
    ? ` <a class="badge badge-ok" href="${deadline.source}" target="_blank" rel="noopener" title="Checked against this page${when}">✓ verified</a>`
    : ' <span class="badge badge-ok">✓ verified</span>';
}

const LINK_TEXT = {
  ok: ['site up', 'This URL responded when it was last checked.'],
  dead: ['link broken', 'This URL returned 404/410 when last checked.'],
};

export function linkFooter(url, status, checkedOn, label = 'Visit site') {
  const [text, help] = LINK_TEXT[status]
    || ['not checked', 'No response either way (timeout, or the host blocked the request).'];
  const when = checkedOn
    ? ` Last checked ${new Date(checkedOn).toLocaleDateString(undefined, { dateStyle: 'medium' })}.`
    : '';
  const dot = { ok: 'dot dot-ok', dead: 'dot dot-dead' }[status] || 'dot';
  const link = url
    ? `<a class="card-link" href="${url}" target="_blank" rel="noopener">${label} ↗</a>`
    : '<span class="link-state">No page</span>';
  return `<div class="card-foot">${link}
    <span class="link-state" title="${help}${when}"><span class="${dot}"></span>${text}</span></div>`;
}

/* Runway meter: full at `window` days out, empty at the deadline. */
export function meter(days, window = 180) {
  if (days === null) return '';
  const pct = Math.max(3, Math.min(100, 100 - (days / window) * 100)).toFixed(0);
  return `<div class="meter" role="img" aria-label="${days} days remaining"><span style="width:${pct}%"></span></div>`;
}

export function flipCard({ status, label, front, back }) {
  return `
  <article class="flip" style="--status:${status}" tabindex="0" aria-label="${label}">
    <div class="flip-inner">
      <div class="face face-front">${front}</div>
      <div class="face face-back">${back}</div>
    </div>
  </article>`;
}
