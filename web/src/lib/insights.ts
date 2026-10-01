/* Build-time aggregations for the field-wide sections of /proceedings/ and the
   "venues like this" and authors panels of each venue page. Everything here
   runs in Astro frontmatter or a static JSON endpoint. */

import {
  getAuthorYears, getResearchEras, getProceedings, getSimilarity, getTermVenueYears, getTopAuthors,
  getTrackedTerms, getVenues, type AuthorYear, type TopAuthor, type TrackedTerm,
} from './db';
import { keywordFile, latestCompleteYear, proceedingsFor, topicsFor } from './proceedings';
import type { Venue } from './types';

let cache: {
  venues: Map<string, Venue>;
  /* papers in the main volume, by venue then year: the denominator for shares */
  papers: Map<string, Map<number, number>>;
  totals: Map<number, number>;
  latest: number | null;
} | null = null;

function base() {
  if (cache) return cache;
  const venues = new Map(getVenues().map((v) => [v.id, v]));
  const papers = new Map<string, Map<number, number>>();
  const totals = new Map<number, number>();
  const rows = getProceedings().filter((p) => p.accepted_count !== null);
  for (const p of rows) {
    if (!papers.has(p.venue_id)) papers.set(p.venue_id, new Map());
    papers.get(p.venue_id)!.set(p.year, p.accepted_count as number);
    totals.set(p.year, (totals.get(p.year) || 0) + (p.accepted_count as number));
  }
  cache = { venues, papers, totals, latest: latestCompleteYear(rows) };
  return cache;
}

export const latestYear = () => base().latest;

/* ---------------------------------------------------------------- eras --- */
export interface EraIdea {
  term: string;
  count: number;      // titles using it in its breakout year
  prev: number;       // yearly average over the three years before
  lift: number;       // growth in share of all titles
  venues: number;
  points: { year: number; share: number }[];   // share of all titles, every year
}
export interface Era { year: number; ideas: EraIdea[] }

/* Each year's breakout ideas, each idea once, with its share of all titles
   over time so the timeline can show what happened next. */
export function eras(from = 2005): Era[] {
  const { totals, latest } = base();
  if (latest === null) return [];
  const counts = new Map<string, Map<number, number>>();
  for (const r of getTermVenueYears()) {
    if (!counts.has(r.term)) counts.set(r.term, new Map());
    const m = counts.get(r.term)!;
    m.set(r.year, (m.get(r.year) || 0) + r.count);
  }
  const byYear = new Map<number, EraIdea[]>();
  for (const r of getResearchEras()) {
    if (r.year > latest) continue;
    const points = [];
    for (let y = from; y <= latest; y += 1) {
      const total = totals.get(y) || 0;
      points.push({ year: y, share: total ? (counts.get(r.term)?.get(y) || 0) / total : 0 });
    }
    const list = byYear.get(r.year) || [];
    list.push({ term: r.term, count: r.count, prev: r.prev_count, lift: r.lift, venues: r.venues, points });
    byYear.set(r.year, list);
  }
  return [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, ideas]) => ({ year, ideas }));
}

/* ------------------------------------------------------ rising, fading --- */
export interface TermLine extends TrackedTerm { points: { year: number; share: number }[] }

/* Field-wide share of titles using each tracked phrase, per year since `from`. */
export function termLines(from = 2005): { rising: TermLine[]; fading: TermLine[] } {
  const { totals, latest } = base();
  if (latest === null) return { rising: [], fading: [] };
  const counts = new Map<string, Map<number, number>>();
  for (const r of getTermVenueYears()) {
    if (!counts.has(r.term)) counts.set(r.term, new Map());
    const m = counts.get(r.term)!;
    m.set(r.year, (m.get(r.year) || 0) + r.count);
  }
  const line = (t: TrackedTerm): TermLine => {
    const points = [];
    for (let y = from; y <= latest; y += 1) {
      const total = totals.get(y) || 0;
      points.push({ year: y, share: total ? (counts.get(t.term)?.get(y) || 0) / total : 0 });
    }
    return { ...t, points };
  };
  const tracked = getTrackedTerms();
  return {
    rising: tracked.filter((t) => t.kind === 'rising').sort((a, b) => b.now_share - a.now_share).slice(0, 10).map(line),
    fading: tracked.filter((t) => t.kind === 'fading').sort((a, b) => b.peak_share - a.peak_share).slice(0, 10).map(line),
  };
}

/* --------------------------------------------------------- field share --- */
/* A venue's area is its primary topic, folded into a handful of groups so the
   chart stays readable. */
const AREA_OF: Record<string, string> = {
  ML: 'Machine learning',
  AI: 'AI',
  CV: 'Vision',
  NLP: 'Language',
  Security: 'Security',
  Systems: 'Systems', Storage: 'Systems', Networking: 'Systems', Architecture: 'Systems', Distributed: 'Systems',
  HPC: 'Systems', Cloud: 'Systems', Performance: 'Systems', Dependability: 'Systems', Databases: 'Systems',
};
export const AREAS = ['Machine learning', 'AI', 'Vision', 'Language', 'Systems', 'Security', 'Other'] as const;

export function fieldShare(from = 2000): { rows: Record<string, number>[]; areas: string[] } {
  const { venues, papers, latest } = base();
  if (latest === null) return { rows: [], areas: [] };
  const rows: Record<string, number>[] = [];
  for (let y = from; y <= latest; y += 1) {
    const row: Record<string, number> = { year: y };
    for (const a of AREAS) row[a] = 0;
    for (const [id, years] of papers) {
      const n = years.get(y);
      if (!n) continue;
      const area = AREA_OF[venues.get(id)?.topics[0] ?? ''] ?? 'Other';
      row[area] += n;
    }
    rows.push(row);
  }
  const areas = AREAS.filter((a) => rows.some((r) => r[a] > 0));
  return { rows, areas };
}

/* ----------------------------------------------------- where it spreads --- */
export interface SpreadFile {
  years: number[];
  venues: [string, string][];            // [id, name]
  papers: number[][];                    // papers[venue][year], the denominators
  terms: Record<string, [number, number[]][]>; // term -> [venueIndex, counts per year]
  suggested: string[];
}

/* One compact file for the spread explorer: counts, not shares, plus the
   denominators once, so the browser does the division. */
export function spreadFile(from = 2010): SpreadFile {
  const { venues, papers, latest } = base();
  const empty: SpreadFile = { years: [], venues: [], papers: [], terms: {}, suggested: [] };
  if (latest === null) return empty;
  const rows = getTermVenueYears().filter((r) => r.year >= from && r.year <= latest);
  if (!rows.length) return empty;
  const years: number[] = [];
  for (let y = from; y <= latest; y += 1) years.push(y);
  const used = [...new Set(rows.map((r) => r.venue_id))].filter((id) => venues.has(id))
    .sort((a, b) => venues.get(a)!.name.localeCompare(venues.get(b)!.name));
  const vIndex = new Map(used.map((id, i) => [id, i]));
  const terms: SpreadFile['terms'] = {};
  const cells = new Map<string, Map<number, number[]>>();
  for (const r of rows) {
    const vi = vIndex.get(r.venue_id);
    if (vi === undefined) continue;
    if (!cells.has(r.term)) cells.set(r.term, new Map());
    const m = cells.get(r.term)!;
    if (!m.has(vi)) m.set(vi, years.map(() => 0));
    m.get(vi)![r.year - from] = r.count;
  }
  for (const [term, m] of cells) terms[term] = [...m.entries()];
  const tracked = getTrackedTerms();
  // a few systems and security phrases, so the chips are not all ML
  const notable = ['serverless', 'rdma', 'kubernetes', 'fuzzing', 'persistent memory'].filter((t) => terms[t]);
  const suggested = [...new Set([
    ...(terms.llms ? ['llms'] : []),
    ...tracked.filter((t) => t.kind === 'rising').sort((a, b) => b.now_share - a.now_share).slice(0, 6).map((t) => t.term),
    ...notable.slice(0, 3),
    ...tracked.filter((t) => t.kind === 'fading').sort((a, b) => b.peak_share - a.peak_share).slice(0, 3).map((t) => t.term),
  ])].filter((t) => terms[t]).slice(0, 13);
  return {
    years,
    venues: used.map((id) => [id, venues.get(id)!.name]),
    papers: used.map((id) => years.map((y) => papers.get(id)?.get(y) ?? 0)),
    terms,
    suggested,
  };
}

/* ------------------------------------------------------------- authors --- */
export interface AuthorsOverview {
  teamSize: { year: number; mean: number }[];
  welcoming: { venue: Venue; share: number; papers: number }[];
  welcomingYear: number | null;
  top: TopAuthor[];
}

export function authorsOverview(from = 2000): AuthorsOverview {
  const { venues, papers, latest } = base();
  const rows = getAuthorYears();
  const empty: AuthorsOverview = { teamSize: [], welcoming: [], welcomingYear: latest, top: [] };
  if (!rows.length || latest === null) return { ...empty, top: getTopAuthors('all').slice(0, 10) };

  // mean authors per paper across all venues, weighted by each venue's papers
  const sums = new Map<number, [number, number]>();
  for (const r of rows) {
    if (r.year < from || r.year > latest) continue;
    const n = papers.get(r.venue_id)?.get(r.year) ?? 0;
    if (!n) continue;
    const s = sums.get(r.year) || [0, 0];
    s[0] += r.mean_authors * n;
    s[1] += n;
    sums.set(r.year, s);
  }
  const teamSize = [...sums.entries()].sort((a, b) => a[0] - b[0])
    .map(([year, [w, n]]) => ({ year, mean: Math.round((w / n) * 100) / 100 }));

  const welcoming = rows
    .filter((r) => r.year === latest && r.newcomer_share !== null && (papers.get(r.venue_id)?.get(latest) ?? 0) >= 50)
    .map((r) => ({ venue: venues.get(r.venue_id)!, share: r.newcomer_share as number, papers: papers.get(r.venue_id)!.get(latest)! }))
    .filter((x) => x.venue)
    .sort((a, b) => b.share - a.share)
    .slice(0, 10);

  return { teamSize, welcoming, welcomingYear: latest, top: getTopAuthors('all').slice(0, 10) };
}

/* ------------------------------------------------------- one venue page --- */
export interface SimilarVenue { venue: Venue; score: number; shared: string[] }

export function similarTo(id: string, n = 5): SimilarVenue[] {
  const { venues } = base();
  return getSimilarity(id)
    .map((s) => ({ venue: venues.get(s.other_id)!, score: s.score, shared: s.shared.slice(0, 5) }))
    .filter((s) => s.venue)
    .slice(0, n);
}

export function venueAuthors(id: string): { years: AuthorYear[]; top: TopAuthor[] } {
  return { years: getAuthorYears(id), top: getTopAuthors(id).slice(0, 10) };
}

/* --------------------------------------------- conference page section --- */
export interface VenueDigest {
  latestYear: number;
  latestCount: number;
  change5: number | null;          // vs five years earlier, as a fraction
  total: number;
  since: number;
  yearsIndexed: number;
  bars: { year: number; count: number; latest: boolean }[];
  authors: { latest: number; year: number; change10: number | null; tenYear: number | null } | null;
  newTeams: { share: number; year: number } | null;
  keywords: string[];
  topics: { term: string; share: number }[];
  similar: SimilarVenue[];
  topAuthors: TopAuthor[];
  links: { title: string; publisher: string; dblp: string }[];
  acceptance: { year: number; rate: number; submitted: number | null; accepted: number | null; source: string } | null;
}

/* Everything the conference page shows from a venue's past proceedings, or
   null when the venue has none (KubeCon, for one, publishes no proceedings). */
export function venueDigest(id: string): VenueDigest | null {
  const rows = proceedingsFor(id).filter((p) => p.accepted_count !== null);
  if (!rows.length) return null;
  const latestYear = latestCompleteYear(rows) ?? rows[rows.length - 1].year;
  const byYear = new Map(rows.map((p) => [p.year, p]));
  const latest = byYear.get(latestYear) ?? rows[rows.length - 1];
  const five = byYear.get(latestYear - 5)?.accepted_count ?? null;
  const latestCount = latest.accepted_count as number;

  const authorRows = getAuthorYears(id);
  const aLatest = authorRows.find((a) => a.year === latestYear) ?? authorRows.filter((a) => a.year <= latestYear).at(-1);
  const aTen = aLatest ? authorRows.find((a) => a.year === aLatest.year - 10) : undefined;
  const newTeam = authorRows.filter((a) => a.year <= latestYear && a.newcomer_share !== null).at(-1);

  const topicRows = topicsFor(id);
  const topicYear = Math.max(...topicRows.map((t) => t.year).filter((y) => y <= latestYear), -1);
  const yearTopics = topicRows.filter((t) => t.year === topicYear);
  const topicTotal = yearTopics.reduce((n, t) => n + t.count, 0) || 1;

  return {
    latestYear,
    latestCount,
    change5: five ? (latestCount - five) / five : null,
    total: rows.reduce((n, p) => n + (p.accepted_count as number), 0),
    since: rows[0].year,
    yearsIndexed: rows.length,
    bars: rows.filter((p) => p.year <= latestYear).map((p) => ({ year: p.year, count: p.accepted_count as number, latest: p.year === latestYear })),
    authors: aLatest
      ? { latest: aLatest.mean_authors, year: aLatest.year, tenYear: aTen?.mean_authors ?? null,
          change10: aTen ? aLatest.mean_authors - aTen.mean_authors : null }
      : null,
    newTeams: newTeam ? { share: newTeam.newcomer_share as number, year: newTeam.year } : null,
    keywords: (keywordFile(id).years[latestYear] || []).slice(0, 12).map(([t]) => t),
    topics: yearTopics.sort((a, b) => b.count - a.count).slice(0, 5).map((t) => ({ term: t.term, share: t.count / topicTotal })),
    similar: similarTo(id, 4),
    topAuthors: getTopAuthors(id).slice(0, 5),
    links: JSON.parse(latest.links || '[]'),
    acceptance: (() => {
      const r = [...proceedingsFor(id)].reverse().find((p) => p.acceptance_rate !== null);
      return r ? { year: r.year, rate: r.acceptance_rate as number, submitted: r.submitted_count,
        accepted: r.accepted_official, source: r.acceptance_source } : null;
    })(),
  };
}
