/* Deadline maths, shared by every page.

   Nothing here stores a day count. The JSON holds ISO strings and the browser
   derives days on each load, which is why a countdown is still right on a
   morning when no rebuild has run. */

export const DAY = 86400000;

/* A deadline's calendar date is the one in ITS OWN timezone, not the viewer's
   and not UTC. 2026-09-17T23:59-12:00 is Sep 18 11:59 UTC, so printing it in
   UTC shows the wrong day - the worst kind of wrong on a deadline tracker. */
export function offsetMinutes(iso) {
  if (!iso) return 0;
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  if (!m) return 0;                       // trailing Z, or no offset
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

export const fmtDate = (ts, offMin = 0) =>
  new Date(ts + offMin * 60000).toLocaleDateString(undefined,
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/* Turn a record's `deadlines` into sorted rounds plus the next one, and place
   it in an urgency band. Bands differ by page - a conference "due this week"
   is not a grant "closing this fortnight" - so they are passed in. */
export function decorate(record, now, bands, key = 'deadlines') {
  const rounds = (record[key] || [])
    .map((d) => ({ ...d, ts: d.date ? Date.parse(d.date) : null, off: offsetMinutes(d.date) }))
    .sort((a, b) => (a.ts ?? Infinity) - (b.ts ?? Infinity));

  const next = rounds.find((r) => r.ts && r.ts > now) || null;
  const hasDates = rounds.some((r) => r.ts);
  const days = next ? Math.ceil((next.ts - now) / DAY) : null;

  return {
    ...record,
    rounds,
    next,
    hasDates,
    days,
    band: days === null ? null : bands.find((b) => days <= b.max),
  };
}

/* First sentence only, for a card front. Splitting on ". " drops the final
   stop, and adding one blindly double-punctuates a note that already had it. */
export const firstSentence = (text) => {
  const first = String(text).split('. ')[0].trim();
  return /[.!?]$/.test(first) ? first : `${first}.`;
};
