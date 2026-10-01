#!/usr/bin/env python3
"""Acceptance rates reported by a community-maintained list, marked as such.

Official figures (acceptance_rates.py) are not available for most venues: the
ACM Digital Library, OpenReview and Springer all sit behind bot challenges.
For the AI, ML, NLP, vision, IR and data-mining venues, the long-running
Conference-Acceptance-Rate list on GitHub (MIT licence) tabulates accepted
and submitted counts per year. This imports those as 'reported' figures:

  * shown on the site as "reported", with the list linked, never as official
  * never written over an official figure; an official one always wins
  * a sanity check against DBLP: the accepted papers must be between a
    quarter and twice the papers DBLP lists that year (the list counts full
    papers, while some venues' DBLP volumes add short papers and posters)

Source: https://github.com/lixin4ever/Conference-Acceptance-Rate (MIT)

  python scripts/community_rates.py --dry-run
  python scripts/community_rates.py --write
"""

from __future__ import annotations

import argparse
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402

REPO = "https://github.com/lixin4ever/Conference-Acceptance-Rate"
RAW = "https://raw.githubusercontent.com/lixin4ever/Conference-Acceptance-Rate/master/README.md"
ALIASES = {"kdd": "sigkdd", "naacl-hlt": "naacl", "thewebconf": "www"}
ROW = re.compile(r"^\|\s*([^|']+?)\s*'(\d{2})\s*\|\s*([^|]+)\|", re.M)
CELL = re.compile(r"(\d{1,2}(?:\.\d+)?)\s*%\s*(?:\(\s*([\d,]+)\s*/\s*([\d,]+)\s*\))?")


def fetch() -> str:
    req = urllib.request.Request(RAW, headers={"User-Agent": "WhiteRabbit/1.0"})
    with urllib.request.urlopen(req, timeout=40) as resp:
        return resp.read().decode("utf-8", "ignore")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    conn = db.connect()
    venues = {db.slugify(r["name"]): r["id"] for r in conn.execute("SELECT id, name FROM venues")}
    written = skipped = unknown = 0
    for name, yy, cell in ROW.findall(fetch()):
        slug = db.slugify(name)
        venue_id = venues.get(slug) or ALIASES.get(slug)
        m = CELL.search(cell)
        if not venue_id or not m:
            unknown += 1
            continue
        year = 2000 + int(yy)
        row = conn.execute("SELECT accepted_count, acceptance_kind, acceptance_rate FROM proceedings "
                           "WHERE venue_id = ? AND year = ?", (venue_id, year)).fetchone()
        if not row or (row["acceptance_rate"] is not None and row["acceptance_kind"] == "official"):
            skipped += 1
            continue
        rate = float(m.group(1)) / 100
        accepted = int(m.group(2).replace(",", "")) if m.group(2) else None
        submitted = int(m.group(3).replace(",", "")) if m.group(3) else None
        if accepted and submitted:
            rate = accepted / submitted
        dblp = row["accepted_count"]
        # the list counts full papers; DBLP's volume often adds short papers and
        # posters (SIGIR, ICDM, CIKM, RecSys), so it can be up to 4x larger
        if not (0.03 <= rate <= 0.7) or (accepted and dblp and not 0.25 <= accepted / dblp <= 2.0):
            print(f"  ! {venue_id} {year}: {cell.strip()[:60]} disagrees with DBLP ({dblp}), skipped")
            skipped += 1
            continue
        conn.execute(
            "UPDATE proceedings SET submitted_count = ?, accepted_official = ?, acceptance_rate = ?, "
            "acceptance_source = ?, acceptance_kind = 'reported' WHERE venue_id = ? AND year = ?",
            (submitted, accepted, round(rate, 4), REPO, venue_id, year))
        written += 1
    print(f"{written} reported rates · {skipped} skipped (official already, no year, or failed the check) · "
          f"{unknown} rows for venues we do not track")
    if not args.write:
        conn.rollback()
        print("(dry run - pass --write to apply)")
        return 0
    conn.commit()
    db.dump(conn)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
