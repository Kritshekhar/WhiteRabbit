#!/usr/bin/env python3
"""Find fellowship deadlines on the programmes' own pages.

Fellowship calls publish their dates only while a cycle is open, and most of
the pages render with JavaScript, so their deadlines sit undated. This reads
each undated fellowship's page the way verify_deadlines.py reads a CFP:
the page itself, the links on it that lead to the call or its dates,
headless Chrome for pages that need JavaScript, and Jina Reader last.

A date is written, and verified with the page as its source, only when:
  * it is on a line about the deadline (deadline, due, closes, submit,
    nomination), not about the call opening, results or the award period
  * it carries an explicit year, is still ahead, and is within 15 months
  * it is the only such date on the programme's pages
When the pages state several, they are queued for a person (wr.py queue).
Federal grants are not touched: grants.gov is their record.

  python scripts/fellowship_dates.py --dry-run
  python scripts/fellowship_dates.py --write --render --jina
"""

from __future__ import annotations

import argparse
import concurrent.futures
import re
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402
import verify_deadlines as V  # noqa: E402

DEADLINE_LINE = re.compile(r"(?i)\b(deadline|due|closes?|closing|submit|submission|nominations?|apply by|applications? (?:are )?due)\b")
NOT_DEADLINE = re.compile(r"(?i)\b(opens?|opening|launch|notif|announce|decision|award(?:ed)? (?:period|start)|start date|begins?|webinar|info session|withdraw)\b"
                          r"|\b(?:reference|recommendation)\s+letters?\s+(?:are\s+)?due|\bletters?\s+(?:of\s+recommendation\s+)?(?:are\s+)?due")


def dates_on(pages: list[tuple[str, str]]) -> dict:
    """Every explicit-year, upcoming deadline date on these pages, with where it was read."""
    today = date.today()
    found: dict = {}
    for source, text in pages:
        for raw in text.splitlines():
            line = re.sub(r"[\s*_|#>]+", " ", raw).strip()
            if not (6 < len(line) < 260) or not DEADLINE_LINE.search(line) or NOT_DEADLINE.search(line):
                continue
            for d, explicit in V.dates_in(line):
                if explicit and today <= d <= today + timedelta(days=455):
                    found.setdefault(d, (source, line))
    return found


def check(item: tuple) -> tuple:
    grant_id, name, url, deadline_id = item
    pages = V.candidate_pages(url) if url else []
    pages += V.deeper_pages(url, V.RAW.get(url, [])) if url else []
    return grant_id, name, deadline_id, dates_on(pages)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--render", action="store_true", help="headless Chrome for JavaScript pages")
    ap.add_argument("--jina", action="store_true", help="Jina Reader as a last resort (keyless)")
    args = ap.parse_args()
    if args.render:
        V.CHROME = V.find_chrome()
    V.JINA = args.jina

    conn = db.connect()
    todo = [(r["id"], r["name"], r["url"], r["deadline_id"]) for r in conn.execute(
        "SELECT g.id, g.name, g.url, gd.id AS deadline_id FROM grants g JOIN grant_deadlines gd ON gd.grant_id = g.id "
        "WHERE g.eligibility = 'PhD student' AND gd.date IS NULL AND gd.status = 'unverified' ORDER BY g.position")]
    print(f"looking for dates for {len(todo)} undated fellowships", file=sys.stderr)

    today = date.today().isoformat()
    set_ = queued = none = 0
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        for grant_id, name, deadline_id, found in pool.map(check, todo):
            if len(found) == 1:
                (d, (source, line)), = found.items()
                iso = f"{d.isoformat()}T23:59:00-12:00"   # a bare date is read as end of day, anywhere on earth
                set_ += 1
                print(f"  ✓ {name}: {d}  | {line[:110]}  ({source})")
                conn.execute("UPDATE grant_deadlines SET date = ?, status = 'verified', source = ?, verified_on = ? "
                             "WHERE id = ?", (iso, source, today, deadline_id))
                db.record_change(conn, "grant", grant_id, "verified", "Application", "", iso, source)
            elif found:
                queued += 1
                print(f"  ? {name}: {len(found)} dates " + ", ".join(str(d) for d in sorted(found)))
                for d, (source, _) in found.items():
                    db.propose(conn, "grant_deadline", deadline_id, "date", f"{d.isoformat()}T23:59:00-12:00", source)
            else:
                none += 1
                print(f"  - {name}: no upcoming deadline published")
    print(f"\n{set_} dates found and verified · {queued} with several dates, queued · {none} not published yet")
    if not args.write:
        conn.rollback()
        print("(dry run - pass --write to apply)")
        return 0
    conn.commit()
    db.dump(conn)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
