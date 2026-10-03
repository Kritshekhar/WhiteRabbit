/* Build-time access to db/whiterabbit.sqlite. Only Astro frontmatter imports
   this; nothing here ships to the browser. */

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Grant, ProceedingsYear, TermCount, Venue } from './types';

/* Walk up from this file to the repo root (the directory holding db/), so the
   path holds both in `astro dev` (src/lib) and in the bundled build (dist/...). */
function findDb(): string {
  if (process.env.WHITERABBIT_DB) return resolve(process.env.WHITERABBIT_DB);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const candidate = resolve(dir, 'db', 'whiterabbit.sqlite');
    if (existsSync(resolve(dir, 'db', 'schema.sql'))) return candidate;
    dir = resolve(dir, '..');
  }
  return resolve(process.cwd(), '..', 'db', 'whiterabbit.sqlite');
}

let handle: Database.Database | null = null;

function db(): Database.Database {
  if (handle) return handle;
  const path = findDb();
  if (!existsSync(path)) {
    throw new Error(
      `WhiteRabbit database not found at ${path}.\n` +
        'Build it from the committed dump first:  python3 scripts/db.py build',
    );
  }
  handle = new Database(path, { readonly: true, fileMustExist: true });
  return handle;
}

type Row = Record<string, any>;
const list = (text: string | null): string[] => (text ? JSON.parse(text) : []);

export function getVenues(): Venue[] {
  const conn = db();
  const deadlines = conn.prepare(
    'SELECT * FROM deadlines WHERE venue_id = ? AND cycle_year IS ? ORDER BY position',
  );
  return (conn.prepare('SELECT * FROM venues ORDER BY position').all() as Row[]).map((v) => {
    return {
      id: v.id,
      name: v.name,
      full_name: v.full_name,
      url: v.url,
      url_template: v.url_template,
      year: v.year,
      month: v.month,
      rolling: Boolean(v.rolling),
      cycle_years: v.cycle_years,
      formats: list(v.formats),
      tracks: list(v.tracks),
      topics: list(v.topics),
      publisher: v.publisher,
      notes: v.notes,
      deadlines: (deadlines.all(v.id, v.year) as Row[]).map((d) => ({
        id: d.id,
        name: d.name,
        date: d.date,
        confirmed: d.status === 'verified',
        track: d.track,
        source: d.source,
        verified_on: d.verified_on,
      })),
      link_status: v.link_status,
      link_checked_on: v.link_checked_on,
    };
  });
}

export function getGrants(): Grant[] {
  const conn = db();
  const deadlines = conn.prepare('SELECT * FROM grant_deadlines WHERE grant_id = ? ORDER BY position');
  return (conn.prepare('SELECT * FROM grants ORDER BY position').all() as Row[]).map((g) => ({
    id: g.id,
    name: g.name,
    funder: g.funder,
    also_funded_by: list(g.also_funded_by),
    eligibility: g.eligibility,
    url: g.url,
    amount: g.amount,
    opportunity_number: g.opportunity_number,
    topics: list(g.topics),
    notes: g.notes,
    ccs: g.ccs,
    ccs_auto: Boolean(g.ccs_auto),
    funding: g.funding ? JSON.parse(g.funding) : {},
    typical_window: g.typical_window,
    last_checked: g.last_checked,
    deadlines: (deadlines.all(g.id) as Row[]).map((d) => ({
      id: d.id,
      name: d.name,
      date: d.date,
      confirmed: d.status === 'verified',
      source: d.source,
      verified_on: d.verified_on,
    })),
    link_status: g.link_status,
  }));
}

export function getMeta(key: string, fallback = ''): string {
  const row = db().prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined;
  return row ? String(row.value) : fallback;
}

/* Proceedings statistics. The tables may be empty; every caller handles []. */
export function getProceedings(venueId?: string): ProceedingsYear[] {
  const sql = venueId
    ? 'SELECT * FROM proceedings WHERE venue_id = ? ORDER BY year'
    : 'SELECT * FROM proceedings ORDER BY venue_id, year';
  const stmt = db().prepare(sql);
  return (venueId ? stmt.all(venueId) : stmt.all()) as ProceedingsYear[];
}

function terms(table: 'proceedings_topics' | 'proceedings_keywords', venueId?: string): TermCount[] {
  const sql = venueId
    ? `SELECT * FROM ${table} WHERE venue_id = ? ORDER BY year, count DESC`
    : `SELECT * FROM ${table} ORDER BY venue_id, year, count DESC`;
  const stmt = db().prepare(sql);
  return (venueId ? stmt.all(venueId) : stmt.all()) as TermCount[];
}

export const getTopics = (venueId?: string) => terms('proceedings_topics', venueId);
export const getKeywords = (venueId?: string) => terms('proceedings_keywords', venueId);

/* Phrases rising across all venues, computed by scripts/proceedings_dblp.py
   from full title counts (the per-venue keyword lists are only a top 30). */
export interface KeywordTrend {
  year: number; term: string; count: number; prev_count: number; venues: number; lift: number;
}
export function getKeywordTrends(year: number): KeywordTrend[] {
  return db().prepare('SELECT * FROM keyword_trends WHERE year = ? ORDER BY count * ln(lift) DESC')
    .all(year) as KeywordTrend[];
}

export function getAllKeywordTrends(): KeywordTrend[] {
  return db().prepare('SELECT * FROM keyword_trends ORDER BY year, count * ln(lift) DESC').all() as KeywordTrend[];
}

/* Each year's breakout ideas, each idea once (scripts/proceedings_dblp.py). */
export interface EraRow { year: number; rank: number; term: string; count: number; prev_count: number; lift: number; venues: number }
export function getResearchEras(): EraRow[] {
  return db().prepare('SELECT * FROM research_eras ORDER BY year, rank').all() as EraRow[];
}

/* Field-wide insights, filled by scripts/proceedings_dblp.py. Every table may
   be empty; every caller handles []. */
export interface TrackedTerm { term: string; kind: 'rising' | 'fading'; peak_year: number; peak_share: number; now_share: number }
export interface TermVenueYear { term: string; venue_id: string; year: number; count: number }
export interface Similarity { venue_id: string; other_id: string; score: number; shared: string[] }
export interface AuthorYear {
  venue_id: string; year: number; mean_authors: number; solo_share: number; newcomer_share: number | null; authors: number;
}
export interface TopAuthor { scope: string; rank: number; name: string; papers: number; first_year: number; last_year: number }

export function getTrackedTerms(): TrackedTerm[] {
  return db().prepare('SELECT * FROM tracked_terms ORDER BY kind, peak_share DESC').all() as TrackedTerm[];
}
export function getTermVenueYears(): TermVenueYear[] {
  return db().prepare('SELECT * FROM term_venue_year').all() as TermVenueYear[];
}
export function getSimilarity(venueId: string): Similarity[] {
  return (db().prepare('SELECT * FROM venue_similarity WHERE venue_id = ? ORDER BY score DESC').all(venueId) as Row[])
    .map((r) => ({ ...r, shared: list(r.shared) })) as Similarity[];
}
export function getAuthorYears(venueId?: string): AuthorYear[] {
  const sql = venueId
    ? 'SELECT * FROM proceedings_authors WHERE venue_id = ? ORDER BY year'
    : 'SELECT * FROM proceedings_authors ORDER BY venue_id, year';
  const stmt = db().prepare(sql);
  return (venueId ? stmt.all(venueId) : stmt.all()) as AuthorYear[];
}
export function getTopAuthors(scope: string): TopAuthor[] {
  return db().prepare('SELECT * FROM top_authors WHERE scope = ? ORDER BY rank').all(scope) as TopAuthor[];
}

/* When the build ran, for the "updated" stamp. Countdowns never use this. */
export const BUILT_AT = new Date().toISOString();

/* The change log behind /changes/ and changes.xml, newest first, with the
   venue or grant name joined in. */
export interface ChangeRow {
  id: number; at: string; entity: 'venue' | 'grant'; entity_id: string; deadline: string;
  kind: 'added' | 'verified' | 'corrected' | 'rolled_over' | 'removed'; before: string; after: string; source: string;
  name: string; year: number | null; topics: string; eligibility: string | null;
}
export function getChanges(entityId?: string): ChangeRow[] {
  const sql = `SELECT c.*, coalesce(v.name, g.name, c.entity_id) AS name, v.year AS year,
      coalesce(v.topics, g.topics, '[]') AS topics, g.eligibility AS eligibility
    FROM changes c
    LEFT JOIN venues v ON c.entity = 'venue' AND v.id = c.entity_id
    LEFT JOIN grants g ON c.entity = 'grant' AND g.id = c.entity_id
    ${entityId ? 'WHERE c.entity_id = ?' : ''}
    ORDER BY c.at DESC, c.id DESC`;
  const stmt = db().prepare(sql);
  return (entityId ? stmt.all(entityId) : stmt.all()) as ChangeRow[];
}

/* Who publishes: papers per institution and per country, per venue-year
   (OpenAlex, for the papers DBLP lists). */
export interface InstitutionYear { venue_id: string; year: number; institution_id: string; papers: number;
  name: string; type: string; country: string }
export function getInstitutionYears(venueId?: string): InstitutionYear[] {
  const sql = `SELECT p.*, i.name, i.type, i.country FROM proceedings_institutions p
    JOIN institutions i ON i.id = p.institution_id ${venueId ? 'WHERE p.venue_id = ?' : ''}`;
  const stmt = db().prepare(sql);
  return (venueId ? stmt.all(venueId) : stmt.all()) as InstitutionYear[];
}
export interface CountryYear { venue_id: string; year: number; country: string; papers: number }
export function getCountryYears(venueId?: string): CountryYear[] {
  const stmt = db().prepare(`SELECT * FROM proceedings_countries ${venueId ? 'WHERE venue_id = ?' : ''}`);
  return (venueId ? stmt.all(venueId) : stmt.all()) as CountryYear[];
}
