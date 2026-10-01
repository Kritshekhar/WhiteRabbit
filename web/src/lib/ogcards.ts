/* What each page's preview image says. Shared by the image endpoints and the
   pages, so the image always matches the page it belongs to. */

import { fmtDate, isAoE, offsetMinutes } from './dates';
import type { Deadline, Grant, Venue } from './types';
import type { OgCard } from './og';

/* The next dated deadline at build time, or the latest one if all have passed. */
function nextDeadline(deadlines: Deadline[]): Deadline | null {
  const dated = deadlines.filter((d) => d.date).sort((a, b) => Date.parse(a.date!) - Date.parse(b.date!));
  return dated.find((d) => Date.parse(d.date!) > Date.now()) ?? null;
}

const when = (d: Deadline) =>
  `${fmtDate(Date.parse(d.date!), offsetMinutes(d.date))}${isAoE(d.date) ? ' AoE' : ''}`;

export function venueCard(v: Venue): OgCard {
  const d = nextDeadline(v.deadlines);
  return {
    eyebrow: 'Conference deadline',
    title: `${v.name}${v.year ? ` ${v.year}` : ''}`,
    subtitle: v.full_name || undefined,
    line: v.rolling ? 'Rolling submission' : d ? `${d.name} · ${when(d)}` : 'Next deadline not announced yet',
    status: d ? (d.confirmed ? 'verified' : 'est.') : null,
  };
}

export function grantCard(g: Grant, audience: 'Fellowship' | 'Grant'): OgCard {
  const d = nextDeadline(g.deadlines);
  return {
    eyebrow: `${audience} deadline`,
    title: g.name.length > 70 ? `${g.name.slice(0, 67)}...` : g.name,
    subtitle: [g.funder, g.amount].filter(Boolean).join(' · ') || undefined,
    line: d ? `${d.name} · ${when(d)}` : g.typical_window ? 'Dates not yet announced' : 'Next deadline not announced yet',
    status: d ? (d.confirmed ? 'verified' : 'est.') : null,
  };
}

export const PAGE_CARDS: Record<string, OgCard> = {
  home: { eyebrow: 'CS deadlines', title: 'Never be late for a very important date.',
    subtitle: 'Conference deadlines, grants and PhD fellowships in computer science, checked against official sources.' },
  conferences: { eyebrow: 'Conferences', title: 'Conference deadlines',
    subtitle: 'Every CS call for papers with a live countdown, verified on the official page.' },
  grants: { eyebrow: 'Funding', title: 'Grant deadlines', subtitle: 'Federal and industry calls for faculty and PIs.' },
  fellowships: { eyebrow: 'Funding', title: 'PhD fellowships', subtitle: 'Fellowships open to PhD students, and when each cycle opens.' },
  proceedings: { eyebrow: 'Proceedings', title: 'What do venues publish?',
    subtitle: 'Papers per year over decades, keywords, topics, and the ideas that broke out each year.' },
  calendar: { eyebrow: 'Calendar feeds', title: 'Deadlines in your calendar',
    subtitle: 'Subscribe once; verified and corrected dates update on their own.' },
  changes: { eyebrow: 'What changed', title: 'What changed',
    subtitle: 'Deadlines newly verified on official pages, corrected, added, or moved to a new cycle.' },
  about: { eyebrow: 'About', title: "A project's path, not a ranking", subtitle: 'Workshop, full paper, journal.' },
};
