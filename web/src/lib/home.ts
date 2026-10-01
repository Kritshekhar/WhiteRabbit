/* Build-time data for the home page, gathered in one place so index.astro
   stays about layout. Read-only use of the shared db and proceedings helpers. */

import type { SearchEntry } from '@/components/islands/HomeSearch';
import type { UpcomingEntry } from '@/components/islands/UpcomingDeadlines';
import { getGrants, getKeywordTrends, getProceedings, getVenues } from './db';
import { latestCompleteYear, venuesWithData } from './proceedings';
import { AUDIENCE_ELIGIBILITY } from './tiers';
import { grantHref, venueHref } from './utils';

export interface HomeStat {
  value: number;
  label: string;
  /* how the count-up prints the number: plain, or compact like 515k */
  format: 'plain' | 'compact';
}

export interface Teaser {
  venue: string;
  fullName: string;
  id: string;
  bars: { year: number; count: number }[];
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export function homeData() {
  const venues = getVenues();
  const grants = getGrants();
  const fellowships = grants.filter((g) => AUDIENCE_ELIGIBILITY.student.includes(g.eligibility));
  const faculty = grants.filter((g) => AUDIENCE_ELIGIBILITY.faculty.includes(g.eligibility));

  const entries: SearchEntry[] = [
    ...venues.map((v) => ({
      kind: 'Conference' as const, name: v.name, sub: v.full_name, href: venueHref(v.id),
      text: `${v.name} ${v.full_name} ${v.topics.join(' ')} ${v.publisher}`.toLowerCase(),
    })),
    ...grants.map((g) => ({
      kind: (fellowships.includes(g) ? 'Fellowship' : 'Grant') as SearchEntry['kind'], name: g.name, sub: g.funder,
      href: grantHref(g.id),
      text: `${g.name} ${g.funder} ${g.topics.join(' ')} ${g.opportunity_number}`.toLowerCase(),
    })),
  ];

  const upcoming: UpcomingEntry[] = [
    ...venues.filter((v) => !v.rolling).map((v) => ({
      kind: 'conference' as const, name: v.name, sub: v.full_name, href: venueHref(v.id), deadlines: v.deadlines, url: v.url,
      key: `venue:${v.id}`,
    })),
    ...grants.map((g) => ({
      kind: 'funding' as const, name: g.name, sub: g.funder, href: grantHref(g.id), deadlines: g.deadlines, url: g.url,
      key: `grant:${g.id}`,
    })),
  ];

  const verified = [...venues, ...grants].reduce((n, r) => n + r.deadlines.filter((d) => d.confirmed).length, 0);

  const rows = getProceedings().filter((p) => p.accepted_count !== null);
  const papers = rows.reduce((n, p) => n + (p.accepted_count as number), 0);
  const firstYear = rows.length ? Math.min(...rows.map((p) => p.year)) : null;
  const indexed = venuesWithData();

  const stats: HomeStat[] = [
    { value: venues.length, label: 'venues tracked', format: 'plain' },
    { value: grants.length, label: 'funding programmes', format: 'plain' },
    { value: verified, label: 'deadlines verified at source', format: 'plain' },
    { value: papers, label: 'papers in main proceedings', format: 'compact' },
    ...(firstYear ? [{ value: new Date().getUTCFullYear() - firstYear, label: 'years of history', format: 'plain' as const }] : []),
  ];

  /* The teaser shows the venue with the most papers in the latest complete
     year: the most dramatic growth curve we have, and a familiar name. */
  const year = latestCompleteYear();
  let teaser: Teaser | null = null;
  if (year !== null) {
    const latest = rows.filter((p) => p.year === year).sort((a, b) => (b.accepted_count as number) - (a.accepted_count as number))[0];
    const venue = latest && venues.find((v) => v.id === latest.venue_id);
    if (venue) {
      teaser = {
        venue: venue.name,
        fullName: venue.full_name,
        id: venue.id,
        bars: rows.filter((p) => p.venue_id === venue.id && p.year <= year && p.year > year - 12)
          .sort((a, b) => a.year - b.year)
          .map((p) => ({ year: p.year, count: p.accepted_count as number })),
      };
    }
  }
  const trending = year !== null ? getKeywordTrends(year).slice(0, 16).map((t) => t.term) : [];

  return {
    entries,
    upcoming,
    verified,
    stats,
    teaser,
    trendingYear: year,
    trending,
    counts: {
      venues: venues.length,
      faculty: faculty.length,
      fellowships: fellowships.length,
      indexed: indexed.length,
      papers,
    },
  };
}
