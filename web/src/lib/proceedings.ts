/* Build-time summaries of the proceedings tables. Everything here runs in
   Astro frontmatter; pages ship only the slice they need. */

import { getKeywords, getKeywordTrends, getProceedings, getTopics, getVenues } from './db';
import type { ProceedingsYear, TermCount, Venue } from './types';

export const CURRENT_YEAR = new Date().getUTCFullYear();

export type YearStatus = 'verified' | 'in-progress' | 'unverified';

/* A finished, checked volume is verified; the current year's volume is still
   growing; anything else has simply not been checked yet. */
export function yearStatus(p: ProceedingsYear): YearStatus {
  if (p.status === 'verified') return 'verified';
  return p.year >= CURRENT_YEAR ? 'in-progress' : 'unverified';
}

let cache: {
  venues: Venue[];
  byVenue: Map<string, ProceedingsYear[]>;
  keywords: TermCount[];
  topics: TermCount[];
} | null = null;

function load() {
  if (cache) return cache;
  const byVenue = new Map<string, ProceedingsYear[]>();
  for (const p of getProceedings()) {
    if (!byVenue.has(p.venue_id)) byVenue.set(p.venue_id, []);
    byVenue.get(p.venue_id)!.push(p);
  }
  cache = { venues: getVenues(), byVenue, keywords: getKeywords(), topics: getTopics() };
  return cache;
}

export function venuesWithData(): Venue[] {
  const { venues, byVenue } = load();
  return venues.filter((v) => (byVenue.get(v.id) || []).some((p) => p.accepted_count !== null));
}

export function proceedingsFor(id: string): ProceedingsYear[] {
  return (load().byVenue.get(id) || []).slice().sort((a, b) => a.year - b.year);
}

const counted = (rows: ProceedingsYear[]) => rows.filter((p) => p.accepted_count !== null);

/* The newest year whose volume is finished: the newest verified year, or
   failing that the newest year before the current one. */
export function latestCompleteYear(rows: ProceedingsYear[] = getAllRows()): number | null {
  const verified = rows.filter((p) => p.status === 'verified').map((p) => p.year);
  if (verified.length) return Math.max(...verified);
  const past = rows.filter((p) => p.year < CURRENT_YEAR).map((p) => p.year);
  return past.length ? Math.max(...past) : null;
}

function getAllRows(): ProceedingsYear[] {
  return [...load().byVenue.values()].flat();
}

export interface VenueSummary {
  latest: ProceedingsYear | null;
  spark: { year: number; count: number }[];
  topKeywords: { term: string; count: number }[];
  hasData: boolean;
}

/* Compact summary for the conference detail page. */
export function venueSummary(id: string): VenueSummary {
  const rows = counted(proceedingsFor(id));
  const latestYear = latestCompleteYear(rows);
  const latest = rows.find((p) => p.year === latestYear) ?? rows[rows.length - 1] ?? null;
  const spark = rows.filter((p) => latest && p.year > latest.year - 5 && p.year <= latest.year)
    .map((p) => ({ year: p.year, count: p.accepted_count as number }));
  const kw = load().keywords.filter((k) => k.venue_id === id && latest && k.year === latest.year)
    .sort((a, b) => b.count - a.count).slice(0, 5).map((k) => ({ term: k.term, count: k.count }));
  return { latest, spark, topKeywords: kw, hasData: rows.length > 0 };
}

export interface Overview {
  year: number | null;
  largest: { venue: Venue; count: number }[];
  growing: { venue: Venue; from: number; to: number; fromYear: number; change: number }[];
  trending: { term: string; count: number; before: number; venues: number }[];
}

/* The cross-venue overview at the top of /proceedings/. */
export function overview(): Overview {
  const { byVenue } = load();
  const venues = venuesWithData();
  const year = latestCompleteYear();
  if (year === null) return { year, largest: [], growing: [], trending: [] };

  const countIn = (id: string, y: number) =>
    byVenue.get(id)?.find((p) => p.year === y && p.accepted_count !== null)?.accepted_count ?? null;

  const largest = venues
    .map((venue) => ({ venue, count: countIn(venue.id, year) }))
    .filter((x): x is { venue: Venue; count: number } => x.count !== null)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  /* Five-year change, against the venue's own count five years earlier. A
     floor of 20 papers keeps a 3-to-12 jump from topping the list. */
  const growing = venues
    .map((venue) => {
      const to = countIn(venue.id, year);
      const from = countIn(venue.id, year - 5);
      return to !== null && from !== null && from >= 20
        ? { venue, from, to, fromYear: year - 5, change: (to - from) / from }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.change - a.change)
    .slice(0, 10);

  /* Trending: precomputed by the pipeline, as a phrase's share of all titles
     in `year` against its share over the three years before. */
  const trending = getKeywordTrends(year).slice(0, 15).map((t) => ({
    term: t.term, count: t.count, before: Math.round(t.prev_count), venues: t.venues,
  }));

  return { year, largest, growing, trending };
}

/* Keywords for one venue, every year, for the JSON endpoint the island
   fetches. Tuples keep the file small: [term, count, score]. */
export function keywordFile(id: string) {
  const years: Record<string, [string, number, number | null][]> = {};
  for (const k of load().keywords) {
    if (k.venue_id !== id) continue;
    (years[k.year] ||= []).push([k.term, k.count, k.score]);
  }
  for (const list of Object.values(years)) list.sort((a, b) => b[1] - a[1]);
  return { venue: id, years };
}

export function topicsFor(id: string): TermCount[] {
  return load().topics.filter((t) => t.venue_id === id);
}
