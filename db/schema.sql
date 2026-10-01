-- WhiteRabbit database schema.
--
-- db/whiterabbit.sql (the committed data dump) is the source of truth; the
-- SQLite file is a build artefact rebuilt from schema + dump by
-- `python scripts/db.py build`. Edit this file to change the shape of the data,
-- and keep scripts/db.py's TABLES order in step with it.
--
-- Verification rule, enforced by CHECK constraints below: a row is `verified`
-- only when a person (or a first-party record such as grants.gov) confirmed it
-- at `source`. A verified row is final and is never crawled again; everything
-- the crawlers revisit comes from the `needs_check` view.
--
-- List-valued fields (topics, formats, ...) are JSON arrays in TEXT columns.

PRAGMA foreign_keys = ON;

-- Site-wide settings, e.g. grace_days and aoe_label.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- conferences
-- ---------------------------------------------------------------------------
CREATE TABLE venues (
  id              TEXT PRIMARY KEY,               -- slug of name
  position        INTEGER NOT NULL,               -- display order, as curated
  name            TEXT NOT NULL UNIQUE,
  full_name       TEXT NOT NULL DEFAULT '',
  tier            TEXT NOT NULL DEFAULT 'full-house'
                  CHECK (tier IN ('rabbit-hole', 'royal-flush', 'full-house', 'looking-glass')),
  url             TEXT NOT NULL DEFAULT '' CHECK (url = '' OR url LIKE 'http%'),
  url_template    TEXT NOT NULL DEFAULT '',
  year            INTEGER,                        -- the cycle `url` points at
  month           INTEGER CHECK (month IS NULL OR month BETWEEN 1 AND 12),
  rolling         INTEGER NOT NULL DEFAULT 0 CHECK (rolling IN (0, 1)),
  cycle_years     INTEGER NOT NULL DEFAULT 1 CHECK (cycle_years BETWEEN 1 AND 5),
  formats         TEXT NOT NULL DEFAULT '[]',
  tracks          TEXT NOT NULL DEFAULT '[]',
  topics          TEXT NOT NULL DEFAULT '[]',
  publisher       TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  dblp_key        TEXT,                           -- e.g. conf/fast, for proceedings stats
  openalex_source_id TEXT,
  link_status     TEXT NOT NULL DEFAULT 'unknown' CHECK (link_status IN ('ok', 'dead', 'unknown')),
  link_checked_on TEXT NOT NULL DEFAULT '',
  CHECK (url_template = '' OR year IS NOT NULL)
);

-- One row per deadline per cycle. A rollover inserts next cycle's rows instead
-- of overwriting, so past cycles stay as history.
CREATE TABLE deadlines (
  id          INTEGER PRIMARY KEY,
  venue_id    TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  cycle_year  INTEGER,                            -- NULL for venues with no year
  position    INTEGER NOT NULL,
  name        TEXT NOT NULL DEFAULT 'Paper submission',
  track       TEXT NOT NULL DEFAULT '',
  date        TEXT,                               -- ISO 8601 with offset; NULL = TBA
  status      TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('verified', 'unverified')),
  source      TEXT NOT NULL DEFAULT '',
  verified_on TEXT NOT NULL DEFAULT '',
  CHECK (status = 'unverified' OR source <> '')
);
CREATE INDEX deadlines_venue ON deadlines (venue_id, cycle_year, position);

-- ---------------------------------------------------------------------------
-- funding
-- ---------------------------------------------------------------------------
CREATE TABLE grants (
  id                 TEXT PRIMARY KEY,
  position           INTEGER NOT NULL,
  name               TEXT NOT NULL UNIQUE,
  funder             TEXT NOT NULL DEFAULT '',
  also_funded_by     TEXT NOT NULL DEFAULT '[]',
  eligibility        TEXT NOT NULL DEFAULT 'Faculty / PI'
                     CHECK (eligibility IN ('PhD student', 'Postdoc', 'Early-career faculty', 'Faculty / PI')),
  url                TEXT NOT NULL DEFAULT '' CHECK (url = '' OR url LIKE 'http%'),
  amount             TEXT NOT NULL DEFAULT '',
  opportunity_number TEXT NOT NULL DEFAULT '',
  topics             TEXT NOT NULL DEFAULT '[]',
  notes              TEXT NOT NULL DEFAULT '',
  ccs                TEXT NOT NULL DEFAULT '',     -- ACM CCS 2012 top-level class
  ccs_auto           INTEGER NOT NULL DEFAULT 0 CHECK (ccs_auto IN (0, 1)),
  funding            TEXT NOT NULL DEFAULT '{}',   -- {total_program, award_ceiling, award_floor, expected_awards}
  typical_window     TEXT NOT NULL DEFAULT '',
  last_checked       TEXT NOT NULL DEFAULT '',
  solicitation       TEXT NOT NULL DEFAULT '',
  source             TEXT NOT NULL DEFAULT '',
  link_status        TEXT NOT NULL DEFAULT 'unknown' CHECK (link_status IN ('ok', 'dead', 'unknown'))
);

CREATE TABLE grant_deadlines (
  id          INTEGER PRIMARY KEY,
  grant_id    TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  name        TEXT NOT NULL DEFAULT 'Application',
  date        TEXT,
  status      TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('verified', 'unverified')),
  source      TEXT NOT NULL DEFAULT '',
  verified_on TEXT NOT NULL DEFAULT '',
  CHECK (status = 'unverified' OR source <> '')
);
CREATE INDEX grant_deadlines_grant ON grant_deadlines (grant_id, position);

-- Full grants.gov synopsis per opportunity, kept for classification.
CREATE TABLE solicitations (
  id                    TEXT PRIMARY KEY,         -- grants.gov opportunity id
  position              INTEGER NOT NULL,
  name                  TEXT NOT NULL DEFAULT '',
  agency                TEXT NOT NULL DEFAULT '',
  opportunity_number    TEXT NOT NULL DEFAULT '',
  close                 TEXT,
  solicitation          TEXT NOT NULL DEFAULT '',
  award_ceiling         INTEGER,
  award_floor           INTEGER,
  total_program_funding INTEGER,
  expected_awards       INTEGER,
  description           TEXT NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------------------
-- proceedings statistics (aggregates only; raw papers live in papers.sqlite)
-- ---------------------------------------------------------------------------
CREATE TABLE proceedings (
  venue_id        TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  year            INTEGER NOT NULL,
  accepted_count  INTEGER,
  submitted_count INTEGER,
  acceptance_rate REAL CHECK (acceptance_rate IS NULL OR acceptance_rate BETWEEN 0 AND 1),
  source          TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('verified', 'unverified')),
  verified_on     TEXT NOT NULL DEFAULT '',
  -- where to read the volume(s): [{title, publisher, dblp}], one per volume
  links           TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (venue_id, year),
  CHECK (status = 'unverified' OR source <> '')
);

CREATE TABLE proceedings_topics (
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  year     INTEGER NOT NULL,
  term     TEXT NOT NULL,
  count    INTEGER NOT NULL,
  score    REAL,
  PRIMARY KEY (venue_id, year, term)
);

CREATE TABLE proceedings_keywords (
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  year     INTEGER NOT NULL,
  term     TEXT NOT NULL,
  count    INTEGER NOT NULL,
  score    REAL,
  PRIMARY KEY (venue_id, year, term)
);

-- Phrases rising across all tracked venues: the share of titles using a phrase
-- in `year` against its share over the three years before. Computed from full
-- title counts, since the per-venue keyword lists above are only a top 30.
CREATE TABLE keyword_trends (
  year       INTEGER NOT NULL,
  term       TEXT NOT NULL,
  count      INTEGER NOT NULL,              -- titles using it in `year`
  prev_count REAL NOT NULL,                 -- yearly average over the 3 years before
  venues     INTEGER NOT NULL,              -- how many venues used it in `year`
  lift       REAL NOT NULL,                 -- share now / share before
  PRIMARY KEY (year, term)
);

-- Phrase counts per venue per year, for a curated set of phrases: the rising
-- ones in keyword_trends plus the ones that peaked and faded. Sums over venues
-- give the field-wide history; per venue it shows where an idea spread.
-- `count` is titles containing the phrase. Only years since 2000, no zeros.
CREATE TABLE term_venue_year (
  term     TEXT NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  year     INTEGER NOT NULL,
  count    INTEGER NOT NULL,
  PRIMARY KEY (term, venue_id, year)
);

-- Each year's breakout ideas: phrases whose share of all titles jumped against
-- the three years before. An idea appears once, in the year it broke out, and
-- generic words ("deep", "neural") give way to the phrases they belong to.
CREATE TABLE research_eras (
  year       INTEGER NOT NULL,
  rank       INTEGER NOT NULL,              -- 1 = the year's breakout idea
  term       TEXT NOT NULL,
  count      INTEGER NOT NULL,              -- titles using it that year
  prev_count REAL NOT NULL,                 -- yearly average over the three years before
  lift       REAL NOT NULL,                 -- share that year / share before
  venues     INTEGER NOT NULL,              -- venues that used it that year
  PRIMARY KEY (year, rank)
);

-- The phrases in term_venue_year and why each was chosen.
CREATE TABLE tracked_terms (
  term        TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('rising', 'fading')),
  peak_year   INTEGER NOT NULL,             -- year of its highest share of all titles
  peak_share  REAL NOT NULL,
  now_share   REAL NOT NULL                 -- share in the latest complete year
);

-- Venues that publish on similar things: cosine similarity of title phrases
-- over the last five complete years. Top matches per venue.
CREATE TABLE venue_similarity (
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  other_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  score    REAL NOT NULL,
  shared   TEXT NOT NULL DEFAULT '[]',      -- JSON: the phrases that overlap most
  PRIMARY KEY (venue_id, other_id)
);

-- Author statistics per venue per year, from DBLP author lists.
CREATE TABLE proceedings_authors (
  venue_id       TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  year           INTEGER NOT NULL,
  mean_authors   REAL NOT NULL,             -- authors per paper
  solo_share     REAL NOT NULL,             -- share of single-author papers
  newcomer_share REAL,                      -- share of papers by an entirely new team: no author had
                                            -- published at the venue before. NULL for its first 3 years
  authors        INTEGER NOT NULL,          -- distinct authors that year
  PRIMARY KEY (venue_id, year)
);

-- Most published authors, per venue and across all venues (scope = 'all').
CREATE TABLE top_authors (
  scope      TEXT NOT NULL,                 -- a venue id, or 'all'
  rank       INTEGER NOT NULL,
  name       TEXT NOT NULL,
  papers     INTEGER NOT NULL,
  first_year INTEGER NOT NULL,
  last_year  INTEGER NOT NULL,
  PRIMARY KEY (scope, rank)
);

-- ---------------------------------------------------------------------------
-- verification queue and crawl history
-- ---------------------------------------------------------------------------

-- A value a crawler found but could not confirm from a first-party source.
-- It never touches the main tables until a person (or a first-party record)
-- verifies it; until then it is re-checked on every run.
CREATE TABLE candidates (
  id             INTEGER PRIMARY KEY,
  entity         TEXT NOT NULL,                   -- deadline | grant_deadline | proceedings | venue
  entity_id      TEXT NOT NULL,
  field          TEXT NOT NULL,
  proposed_value TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT '',
  first_seen     TEXT NOT NULL,
  last_checked   TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (entity, entity_id, field, proposed_value)
);

-- What changed, for the "What changed" page and its RSS feed. Every script
-- that adds, verifies, corrects or rolls over a deadline records it through
-- scripts/db.py record_change(). Kept for a year.
CREATE TABLE changes (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL,                  -- UTC timestamp
  entity    TEXT NOT NULL CHECK (entity IN ('venue', 'grant')),
  entity_id TEXT NOT NULL,
  deadline  TEXT NOT NULL DEFAULT '',       -- the deadline's name; '' for the venue or grant itself
  kind      TEXT NOT NULL CHECK (kind IN ('added', 'verified', 'corrected', 'rolled_over', 'removed')),
  before    TEXT NOT NULL DEFAULT '',       -- the date before (ISO), or the old cycle
  after     TEXT NOT NULL DEFAULT '',       -- the date after, or the new cycle
  source    TEXT NOT NULL DEFAULT ''        -- where the new value was read
);
CREATE INDEX changes_at ON changes (at);

-- Latest fetch per URL, so a run can prove what it did and did not touch.
CREATE TABLE crawl_log (
  url          TEXT PRIMARY KEY,
  fetched_at   TEXT NOT NULL,
  http_status  INTEGER,
  content_hash TEXT
);

-- Everything a crawler may revisit. Verified rows are final, so they never
-- appear here: a rolled-over cycle gets fresh unverified rows, and a current
-- year's proceedings stay unverified until the volume is closed.
CREATE VIEW needs_check AS
  SELECT 'deadline' AS entity, CAST(d.id AS TEXT) AS entity_id, d.venue_id AS owner, v.url AS url
    FROM deadlines d JOIN venues v ON v.id = d.venue_id
   WHERE d.status = 'unverified' AND d.cycle_year IS v.year
  UNION ALL
  SELECT 'grant_deadline', CAST(gd.id AS TEXT), gd.grant_id, g.url
    FROM grant_deadlines gd JOIN grants g ON g.id = gd.grant_id
   WHERE gd.status = 'unverified'
  UNION ALL
  SELECT 'proceedings', p.venue_id || '/' || p.year, p.venue_id, p.source
    FROM proceedings p
   WHERE p.status = 'unverified';
