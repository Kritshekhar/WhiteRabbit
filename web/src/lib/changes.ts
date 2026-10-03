/* Change-log entries in the shape the "What changed" page and feed show. */

import { areaOf } from './areas';
import { getChanges, type ChangeRow } from './db';
import { fmtDate, isAoE, offsetMinutes } from './dates';
import { AUDIENCE_ELIGIBILITY } from './labels';
import { grantHref, venueHref } from './utils';

export interface ChangeItem {
  id: number;
  at: string;
  day: string;           // YYYY-MM-DD, for grouping
  kind: ChangeRow['kind'];
  section: 'conferences' | 'grants' | 'fellowships';
  area: string;          // research area slug, or the funding section
  name: string;          // "OSDI 2027" or the grant's name
  href: string;
  deadline: string;
  headline: string;      // one line, e.g. "Abstract registration verified: Dec 1, 2026 AoE"
  before: string;
  after: string;
  source: string;
}

export const showDate = (iso: string) =>
  iso ? `${fmtDate(Date.parse(iso), offsetMinutes(iso))}${isAoE(iso) ? ' AoE' : ''}` : 'no date';

const VERB: Record<ChangeRow['kind'], string> = {
  added: 'added', verified: 'verified', corrected: 'corrected', rolled_over: 'moved to its next cycle', removed: 'removed',
};

function headline(c: ChangeRow): string {
  const what = c.deadline || (c.entity === 'venue' ? 'Venue' : 'Programme');
  switch (c.kind) {
    case 'verified': return `${what} verified on the official page: ${showDate(c.after)}`;
    case 'corrected': return `${what} corrected: ${showDate(c.before)} → ${showDate(c.after)}`;
    case 'rolled_over': return `Moved to the ${c.after} edition (dates estimated until verified)`;
    case 'added': return c.deadline ? `${what} added: ${showDate(c.after)}` : `Now tracked${c.after ? `, next deadline ${showDate(c.after)}` : ''}`;
    default: return `${what} ${VERB[c.kind]}`;
  }
}

export function changeItems(entityId?: string): ChangeItem[] {
  return getChanges(entityId).map((c) => {
    const student = c.eligibility ? AUDIENCE_ELIGIBILITY.student.includes(c.eligibility) : false;
    const section = c.entity === 'venue' ? 'conferences' : student ? 'fellowships' : 'grants';
    return {
      id: c.id,
      at: c.at,
      day: c.at.slice(0, 10),
      kind: c.kind,
      section,
      area: c.entity === 'venue' ? areaOf({ topics: JSON.parse(c.topics || '[]') }) : section,
      name: c.entity === 'venue' && c.year ? `${c.name} ${c.year}` : c.name,
      href: c.entity === 'venue' ? venueHref(c.entity_id) : grantHref(c.entity_id),
      deadline: c.deadline,
      headline: headline(c),
      before: c.before,
      after: c.after,
      source: c.source,
    };
  });
}
