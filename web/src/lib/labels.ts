/* Labels and urgency bands shared by every page, defined once. */

import type { Band } from './dates';

/* Urgency bands. `color` is a status token; `label` always ships beside it,
   so the state never depends on colour alone. */
export const VENUE_BANDS: Band[] = [
  { max: 7, color: 'var(--critical)', label: 'Due this week' },
  { max: 21, color: 'var(--serious)', label: 'Due this month' },
  { max: 60, color: 'var(--warning)', label: 'Approaching' },
  { max: Infinity, color: 'var(--good)', label: 'On the horizon' },
];

export const GRANT_BANDS: Band[] = [
  { max: 14, color: 'var(--critical)', label: 'Closing this fortnight' },
  { max: 45, color: 'var(--serious)', label: 'Closing soon' },
  { max: 120, color: 'var(--warning)', label: 'Approaching' },
  { max: Infinity, color: 'var(--good)', label: 'On the horizon' },
];

export const WHO_SLOT: Record<string, 'top' | 'mid' | 'base'> = {
  'PhD student': 'top',
  Postdoc: 'mid',
  'Early-career faculty': 'mid',
  'Faculty / PI': 'base',
};

/* One dataset, two pages: a PhD fellowship and a $1M PI grant are different
   things with different readers. */
export type Audience = 'student' | 'faculty';
export const AUDIENCE_ELIGIBILITY: Record<Audience, string[]> = {
  student: ['PhD student'],
  faculty: ['Faculty / PI', 'Early-career faculty', 'Postdoc'],
};

// Government money and industry money have different rules and timelines.
export const GOVERNMENT = /^(NSF|DOE|DoD|DARPA|ONR|AFOSR|Army|NASA|NIH)/i;

export type VenueStatus = 'rolling' | 'upcoming' | 'passed' | 'tba';
export type GrantStatus = 'open' | 'closed' | 'tba';

/* `status` is venue vocabulary: a journal is "rolling", a finished cycle is "passed". */
export function venueStatus(v: { rolling: boolean; next: unknown; hasDates: boolean }): VenueStatus {
  if (v.rolling) return 'rolling';
  if (v.next) return 'upcoming';
  return v.hasDates ? 'passed' : 'tba';
}

export function grantStatus(g: { next: unknown; hasDates: boolean }): GrantStatus {
  return g.next ? 'open' : g.hasDates ? 'closed' : 'tba';
}
