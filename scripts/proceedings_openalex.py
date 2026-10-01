#!/usr/bin/env python3
"""Who publishes at each venue, and on what, from OpenAlex.

For each venue-year this takes the DOIs DBLP listed (cache/papers.sqlite, from
proceedings_dblp.py) and asks OpenAlex to group exactly those works, 100 DOIs
per request, three ways:

  institutions  papers per author institution     -> proceedings_institutions
  countries     papers per author country         -> proceedings_countries
  topics        papers per OpenAlex research topic -> proceedings_topics

OpenAlex's own venue records for conferences are patchy (FAST has 181 works
there, against thousands on DBLP), so it is never asked "which works are in
venue X", only about the works DBLP named. A paper counts once for every
institution (or country) among its authors.

Keyless use is capped at 1,000 requests a day, so this is a resumable
backfill sharing that budget: institutions and countries for the newest
years first, then topics. A venue-year is written only once all its batches
are in, and a finished year is never fetched again. Set OPENALEX_API_KEY to
go faster.

  python scripts/proceedings_openalex.py                 # until the budget is spent
  python scripts/proceedings_openalex.py --max-requests 50
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402
from proceedings_dblp import JOURNAL_VENUES, NOT_A_PAPER, PAPERS, journal_rows, main_tocs  # noqa: E402

API = "https://api.openalex.org"
BATCH = 100                 # OpenAlex accepts up to 100 OR-ed values per filter
RESERVE = 20                # leave a few requests of the daily budget unused
MAILTO = "kjha9@asu.edu"    # OpenAlex's "polite pool" asks for a contact address
WHO_YEARS = 6               # institutions and countries: the current year and the five before
DESCRIBE_RESERVE = 40       # requests kept for typing institutions, 50 per request

# name, OpenAlex group_by field, table, rows kept per venue-year (None = all)
DIMENSIONS = [
    ("institutions", "authorships.institutions.id", "proceedings_institutions", 25),
    ("countries", "authorships.countries", "proceedings_countries", None),
    ("topics", "topics.id", "proceedings_topics", 20),
]


class OutOfBudget(Exception):
    pass


def call(path: str, params: dict) -> tuple[dict, int | None]:
    """One OpenAlex request; returns the JSON and the requests left today."""
    params = {**params, "mailto": MAILTO}
    if os.environ.get("OPENALEX_API_KEY"):
        params["api_key"] = os.environ["OPENALEX_API_KEY"]
    req = urllib.request.Request(f"{API}/{path}?{urllib.parse.urlencode(params, safe=':|/,')}",
                                 headers={"User-Agent": "WhiteRabbit-stats/1.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                left = resp.headers.get("x-ratelimit-remaining")
                return json.loads(resp.read()), int(left) if left and left.isdigit() else None
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                raise OutOfBudget
            time.sleep(2 * (attempt + 1))
        except Exception:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("OpenAlex request failed three times")


def grouped(field: str, dois: list[str]) -> tuple[Counter, dict, int | None]:
    """Counts per group for these DOIs, the groups' display names, and budget left."""
    data, left = call("works", {"filter": "doi:" + "|".join(dois), "group_by": field})
    counts, names = Counter(), {}
    for g in data.get("group_by") or []:
        key = (g.get("key") or "").rsplit("/", 1)[-1]
        if not key or key == "unknown" or g.get("key_display_name") in (None, "unknown"):
            continue
        counts[key] += g["count"]
        names[key] = g["key_display_name"]
    return counts, names, left


def venue_years(papers, conn) -> list[tuple]:
    """(venue_id, year, sorted DOIs) for every venue-year with papers."""
    out = []
    for v in conn.execute("SELECT id, dblp_key FROM venues WHERE dblp_key IS NOT NULL"):
        if v["id"] in JOURNAL_VENUES:
            rows, tocs = journal_rows(papers, v["id"], with_doi=True)
            rows = [(y, t, title, doi) for y, t, title, _, doi in rows]
        else:
            rows = papers.execute("SELECT year, toc, title, doi FROM papers WHERE stream = ? AND year IS NOT NULL",
                                  (v["dblp_key"],)).fetchall()
            tocs = main_tocs([(y, t) for y, t, _, _ in rows], v["dblp_key"])
        for year, keep in tocs.items():
            dois = sorted({d for y, t, title, d in rows if y == year and t in keep and d and not NOT_A_PAPER.match(title)})
            if dois:
                out.append((v["id"], year, dois))
    return out


def save(conn, table: str, venue_id: str, year: int, counts: Counter, keep: int | None, names: dict) -> None:
    conn.execute(f"DELETE FROM {table} WHERE venue_id = ? AND year = ?", (venue_id, year))
    top = counts.most_common(keep)
    if table == "proceedings_topics":
        total = sum(counts.values()) or 1
        conn.executemany("INSERT INTO proceedings_topics (venue_id, year, term, count, score) VALUES (?, ?, ?, ?, ?)",
                         [(venue_id, year, names[k], n, round(n / total, 4)) for k, n in top])
    elif table == "proceedings_institutions":
        conn.executemany("INSERT INTO proceedings_institutions (venue_id, year, institution_id, papers) VALUES (?, ?, ?, ?)",
                         [(venue_id, year, k, n) for k, n in top])
        conn.executemany("INSERT INTO institutions (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING",
                         [(k, names[k]) for k, _ in top])
    else:
        conn.executemany("INSERT INTO proceedings_countries (venue_id, year, country, papers) VALUES (?, ?, ?, ?)",
                         [(venue_id, year, k, n) for k, n in top])


def describe_institutions(conn, budget: int) -> int:
    """Type (education, company, ...) and country for institutions not yet described."""
    ids = [r[0] for r in conn.execute("SELECT id FROM institutions WHERE type = ''")]
    used = 0
    for i in range(0, len(ids), 50):
        if used >= budget:
            break
        data, _ = call("institutions", {"filter": "openalex:" + "|".join(ids[i:i + 50]), "per-page": 50,
                                         "select": "id,display_name,type,country_code"})
        used += 1
        for inst in data.get("results") or []:
            conn.execute("UPDATE institutions SET name = ?, type = ?, country = ? WHERE id = ?",
                         (inst.get("display_name") or "", inst.get("type") or "other", inst.get("country_code") or "",
                          inst["id"].rsplit("/", 1)[-1]))
    return used


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-requests", type=int, default=1000)
    args = ap.parse_args()
    if not PAPERS.exists():
        print("cache/papers.sqlite is missing - run scripts/proceedings_dblp.py first", file=sys.stderr)
        return 1

    papers = sqlite3.connect(PAPERS)
    this_year = date.today().year
    used = 0
    with db.session() as conn:
        all_years = venue_years(papers, conn)
        # Round-robin: every venue's most recent year first, then each venue's
        # next most recent, so all venues show something within days rather
        # than one venue getting its whole history first. Top tiers lead.
        tier = {r["id"]: {"royal-flush": 0, "full-house": 1}.get(r["tier"], 2)
                for r in conn.execute("SELECT id, tier FROM venues")}
        depth: dict[tuple, int] = {}
        for venue_id in {v for v, _, _ in all_years}:
            years = sorted((y for v, y, _ in all_years if v == venue_id), reverse=True)
            depth.update({(venue_id, y): i for i, y in enumerate(years)})
        queue = []
        for name, field, table, keep in DIMENSIONS:
            have = {(r[0], r[1]) for r in conn.execute(f"SELECT DISTINCT venue_id, year FROM {table}")}
            for venue_id, year, dois in all_years:
                if name != "topics" and year < this_year - WHO_YEARS + 1:
                    continue
                # a finished year is fetched once; the current year, whose volume is
                # still filling in, is refreshed on the first of each month
                if (venue_id, year) in have and (year < this_year or date.today().day != 1):
                    continue
                queue.append((0 if name != "topics" else 1, depth[(venue_id, year)], tier.get(venue_id, 2),
                              name, field, table, keep, venue_id, year, dois))
        queue.sort(key=lambda q: q[:3])
        need = sum(-(-len(q[-1]) // BATCH) for q in queue)
        print(f"{len(queue)} venue-year breakdowns to fetch ({need} requests); budget this run {args.max_requests}")

        done = Counter()
        stop = False
        for _, _, _, name, field, table, keep, venue_id, year, dois in queue:
            batches = [dois[i:i + BATCH] for i in range(0, len(dois), BATCH)]
            # keep a share of the budget for describing new institutions (type, country)
            if used + len(batches) > args.max_requests - DESCRIBE_RESERVE:
                continue   # too big for what is left today; a smaller one may still fit
            counts, names, left = Counter(), {}, None
            try:
                for batch in batches:
                    c, n, left = grouped(field, batch)
                    counts.update(c)
                    names.update(n)
                    used += 1
            except OutOfBudget:
                print("OpenAlex budget exhausted for today; the next run resumes here")
                stop = True
            if stop:
                break   # this venue-year is incomplete, so nothing is written for it
            save(conn, table, venue_id, year, counts, keep, names)
            conn.commit()
            done[name] += 1
            if left is not None and left < RESERVE:
                print("stopping to keep a reserve of today's OpenAlex budget")
                break
        try:
            used += describe_institutions(conn, max(0, args.max_requests - used))
        except OutOfBudget:
            pass
    left_over = len(queue) - sum(done.values())
    print(f"written: {dict(done)} using {used} requests; {left_over} venue-year breakdowns left for later runs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
