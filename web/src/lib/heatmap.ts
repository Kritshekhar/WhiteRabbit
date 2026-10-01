/* When each venue's main submission deadline falls, by research area and
   month, for planning a year of submissions.

   One deadline per venue: its paper submission, or its earliest deadline if it
   only lists an abstract. The month is read in the deadline's own timezone, so
   "Dec 1 AoE" counts as December. A venue whose current cycle has passed still
   counts in that month, because that is when its next call will be. */

import { AREAS, areaOf } from './areas';
import { offsetMinutes } from './dates';
import type { Deadline, Venue } from './types';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];

const isAbstract = (d: Deadline) => /abstract|registration|title/i.test(d.name);

/* The month (0-11) of a venue's main deadline, or null if it has none dated. */
export function deadlineMonth(v: Pick<Venue, 'deadlines' | 'rolling'>): number | null {
  if (v.rolling) return null;
  const dated = v.deadlines.filter((d) => d.date);
  if (!dated.length) return null;
  const main = dated.find((d) => !isAbstract(d)) ?? dated[0];
  const iso = main.date as string;
  return new Date(Date.parse(iso) + offsetMinutes(iso) * 60000).getUTCMonth();
}

export interface HeatRow { slug: string; label: string; counts: number[]; total: number }

export function heatmap(venues: Venue[]): { rows: HeatRow[]; totals: number[]; max: number } {
  const rows = AREAS.map((a) => ({ slug: a.slug, label: a.label, counts: Array(12).fill(0) as number[], total: 0 }));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  for (const v of venues) {
    const m = deadlineMonth(v);
    if (m === null) continue;
    const row = bySlug.get(areaOf(v));
    if (!row) continue;
    row.counts[m] += 1;
    row.total += 1;
  }
  const kept = rows.filter((r) => r.total > 0);
  const totals = MONTHS.map((_, m) => kept.reduce((n, r) => n + r.counts[m], 0));
  const max = Math.max(1, ...kept.flatMap((r) => r.counts));
  return { rows: kept, totals, max };
}
