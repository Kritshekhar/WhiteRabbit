#!/usr/bin/env python3
"""Topic breakdown of each venue's papers, per year, from OpenAlex.

OpenAlex tags every work with research topics. Its venue records for
conferences are patchy (FAST has 181 works there, against thousands on DBLP),
so this does not ask "which works are in venue X". It takes the DOIs DBLP
listed for a venue-year (cache/papers.sqlite, from proceedings_dblp.py) and
asks OpenAlex to group exactly those works by topic, 100 DOIs per request.

Keyless use is capped at 1,000 requests a day, which is not enough for full
history in one go. So this is a resumable backfill: newest years first, it
stops before the day's budget runs out, and the next run carries on. A
venue-year is written only once all of its batches are in, and a finished
year's topics are never fetched again. Set OPENALEX_API_KEY to go faster.

  python scripts/proceedings_openalex.py               # backfill until the budget is spent
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
from proceedings_dblp import PAPERS, main_tocs, NOT_A_PAPER  # noqa: E402

API = "https://api.openalex.org/works"
BATCH = 100                 # OpenAlex accepts up to 100 OR-ed values per filter
TOP_TOPICS = 20             # per venue per year
RESERVE = 20                # leave a few requests of the daily budget unused
MAILTO = "kjha9@asu.edu"    # OpenAlex's "polite pool" asks for a contact address


class OutOfBudget(Exception):
    pass


def group_by_topics(dois: list[str]) -> tuple[Counter, int | None]:
    """Topic counts for these DOIs, and the requests left in today's budget."""
    params = {"filter": "doi:" + "|".join(dois), "group_by": "topics.id", "mailto": MAILTO}
    key = os.environ.get("OPENALEX_API_KEY")
    if key:
        params["api_key"] = key
    req = urllib.request.Request(f"{API}?{urllib.parse.urlencode(params, safe=':|/')}",
                                 headers={"User-Agent": "WhiteRabbit-stats/1.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read())
                left = resp.headers.get("x-ratelimit-remaining")
            counts = Counter({g["key_display_name"]: g["count"] for g in data.get("group_by") or []
                              if g.get("key_display_name") and g["key_display_name"] != "unknown"})
            return counts, int(left) if left and left.isdigit() else None
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                raise OutOfBudget
            time.sleep(2 * (attempt + 1))
        except Exception:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("OpenAlex request failed three times")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-requests", type=int, default=1000)
    args = ap.parse_args()
    if not PAPERS.exists():
        print("cache/papers.sqlite is missing - run scripts/proceedings_dblp.py first", file=sys.stderr)
        return 1

    papers = sqlite3.connect(PAPERS)
    this_year = date.today().year
    used = done = 0
    with db.session() as conn:
        have = {(r[0], r[1]) for r in conn.execute("SELECT DISTINCT venue_id, year FROM proceedings_topics")}
        todo = []
        for v in conn.execute("SELECT id, dblp_key FROM venues WHERE dblp_key IS NOT NULL"):
            rows = papers.execute("SELECT year, toc, title, doi FROM papers WHERE stream = ? AND year IS NOT NULL",
                                  (v["dblp_key"],)).fetchall()
            tocs = main_tocs([(y, t) for y, t, _, _ in rows], v["dblp_key"])
            for year, keep in tocs.items():
                # a finished year is fetched once; the current year is refreshed
                if (v["id"], year) in have and year < this_year:
                    continue
                dois = sorted({d for y, t, title, d in rows
                               if y == year and t in keep and d and not NOT_A_PAPER.match(title)})
                if dois:
                    todo.append((year, v["id"], dois))
        todo.sort(key=lambda t: (-t[0], t[1]))   # newest years first
        need = sum(-(-len(d) // BATCH) for _, _, d in todo)
        print(f"{len(todo)} venue-years need topics ({need} requests); budget this run {args.max_requests}")

        for year, venue_id, dois in todo:
            batches = [dois[i:i + BATCH] for i in range(0, len(dois), BATCH)]
            if used + len(batches) > args.max_requests:
                break
            counts: Counter = Counter()
            left = None
            try:
                for batch in batches:
                    c, left = group_by_topics(batch)
                    counts.update(c)
                    used += 1
            except OutOfBudget:
                # this venue-year is incomplete, so nothing is written for it
                print("OpenAlex budget exhausted for today; the next run resumes here")
                break
            conn.execute("DELETE FROM proceedings_topics WHERE venue_id = ? AND year = ?", (venue_id, year))
            total = sum(counts.values()) or 1
            conn.executemany(
                "INSERT INTO proceedings_topics (venue_id, year, term, count, score) VALUES (?, ?, ?, ?, ?)",
                [(venue_id, year, term, n, round(n / total, 4)) for term, n in counts.most_common(TOP_TOPICS)])
            conn.commit()
            done += 1
            if left is not None and left < RESERVE:
                print("stopping to keep a reserve of today's OpenAlex budget")
                break
    remaining = len(todo) - done
    print(f"topics written for {done} venue-years using {used} requests; {remaining} left for later runs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
