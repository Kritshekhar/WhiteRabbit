#!/usr/bin/env python3
"""Acceptance rates, from the venues' own published figures.

Only official sources count. Today that is USENIX: for OSDI, NSDI, FAST, ATC
and USENIX Security, each conference's "Message from the Program Co-Chairs"
(a short PDF, or the front matter of the proceedings) states how many papers
were submitted and accepted. Other publishers' tables (the ACM Digital
Library) and review platforms (OpenReview) sit behind bot challenges, so they
are not read; this module is where further official sources would go.

A year's rate is written only when the message is unambiguous:
  * exactly one submission count and one acceptance count are stated
  * fewer accepted than submitted, and a rate between 5% and 60%
  * and if the message also states a rate, the two agree within 1.5 points
Anything else (several submission cycles, revisions carried over) is queued
for a person (wr.py queue), never guessed.

  python scripts/acceptance_rates.py --dry-run
  python scripts/acceptance_rates.py --write
"""

from __future__ import annotations

import argparse
import concurrent.futures
import io
import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
USENIX = {"osdi": "osdi", "nsdi": "nsdi", "fast": "fast", "atc": "atc", "usenix-security": "usenixsecurity"}
FIRST_YEAR = 2010

NUM = r"(\d{1,2},\d{3}|\d{1,5})"
SUBMITTED = [
    re.compile(rf"(?i)\breceived\s+(?:a\s+(?:total|record)\s+(?:of\s+)?|over\s+|some\s+)?{NUM}\s+(?:\w+\s+){{0,3}}?submissions"),
    re.compile(rf"(?i)\b{NUM}\s+(?:\w+\s+){{0,2}}?(?:paper\s+)?submissions\s+(?:were|was)\s+(?:received|submitted)"),
    re.compile(rf"(?i)\btotal\s+of\s+{NUM}\s+(?:\w+\s+){{0,2}}?submissions"),
    re.compile(rf"(?i)\bout\s+of\s+{NUM}\s+(?:\w+\s+){{0,2}}?submissions"),
]
ACCEPTED = [
    re.compile(rf"(?i)\b(?:we\s+)?accepted\s+{NUM}\s+(?:\w+\s+){{0,2}}?(?:papers|submissions)"),
    re.compile(rf"(?i)\b{NUM}\s+(?:\w+\s+){{0,2}}?(?:papers|submissions)\s+(?:were|have\s+been)\s+accepted"),
    re.compile(rf"(?i)\b{NUM}\s+accepted\s+papers"),
]
RATE = re.compile(r"(?i)(\d{1,2}(?:\.\d+)?)\s?%\s+acceptance\s+rate|acceptance\s+rate\s+(?:of|was|is)\s+(?:about\s+)?(\d{1,2}(?:\.\d+)?)\s?%")


def get(url: str, limit: int = 30_000_000) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read(limit)
    except Exception:
        return b""


def message_pdf(slug: str, year: int) -> str:
    """The chairs' message (or front matter) PDF linked from that year's programme."""
    page = get(f"https://www.usenix.org/conference/{slug}{year % 100:02d}/technical-sessions").decode("utf-8", "ignore")
    links = re.findall(r'href="([^"]*(?:_message|-message|front[_-]?matter)[^"]*\.pdf)"', page)
    if not links:
        return ""
    link = links[0]
    return link if link.startswith("http") else f"https://www.usenix.org{link}"


def pdf_text(data: bytes, pages: int = 6) -> str:
    from pypdf import PdfReader   # only this script needs it
    try:
        reader = PdfReader(io.BytesIO(data))
        text = " ".join((p.extract_text() or "") for p in reader.pages[:pages])
    except Exception:
        return ""
    return re.sub(r"\s+", " ", text)


def number(s: str) -> int:
    return int(s.replace(",", ""))


def extract(text: str) -> dict:
    """The figures a chairs' message states, and whether they are unambiguous.

    Clear means one of:
      * one submission count and one acceptance count, agreeing with the rate
        the message states, or (if it states none) giving at most 35%: a
        multi-cycle year can pair one cycle's submissions with the whole
        year's acceptances, and that shows up as an implausibly high rate
      * one count and one stated rate (the other count is then not stored)
    """
    subs = sorted({number(m.group(1)) for p in SUBMITTED for m in p.finditer(text)})
    accs = sorted({number(m.group(1)) for p in ACCEPTED for m in p.finditer(text)})
    rates = sorted({float(m.group(1) or m.group(2)) for m in RATE.finditer(text)})
    out = {"submitted": subs, "accepted": accs, "rates": rates, "clear": False,
           "submitted_count": None, "accepted_count": None, "rate": None}
    stated = rates[0] / 100 if len(rates) == 1 else None
    if len(subs) == 1 and len(accs) == 1 and accs[0] < subs[0]:
        rate = accs[0] / subs[0]
        if (stated is not None and abs(stated - rate) <= 0.015) or (not rates and 0.05 <= rate <= 0.35):
            out.update(submitted_count=subs[0], accepted_count=accs[0], rate=round(rate, 4), clear=True)
    elif stated is not None and 0.05 <= stated <= 0.6:
        if len(subs) == 1 and not accs:
            out.update(submitted_count=subs[0], rate=stated, clear=True)
        elif len(accs) == 1 and not subs:
            out.update(accepted_count=accs[0], rate=stated, clear=True)
    return out


def check(item: tuple) -> tuple:
    venue_id, slug, year = item
    url = message_pdf(slug, year)
    if not url:
        return venue_id, year, url, None
    return venue_id, year, url, extract(pdf_text(get(url)))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    conn = db.connect()
    todo = [(r["venue_id"], USENIX[r["venue_id"]], r["year"]) for r in conn.execute(
        f"SELECT venue_id, year FROM proceedings WHERE venue_id IN ({','.join('?' * len(USENIX))}) "
        "AND year >= ? AND year < ? AND acceptance_rate IS NULL ORDER BY venue_id, year",
        (*USENIX, FIRST_YEAR, date.today().year + 1))]
    print(f"{len(todo)} USENIX venue-years without an official acceptance rate", file=sys.stderr)

    written = queued = missing = 0
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        for venue_id, year, url, found in pool.map(check, todo):
            if not url or found is None:
                missing += 1
                continue
            # cross-check against DBLP: the accepted papers implied by the message
            # must be within a factor of two of the papers DBLP lists that year
            dblp = conn.execute("SELECT accepted_count FROM proceedings WHERE venue_id = ? AND year = ?",
                                (venue_id, year)).fetchone()[0]
            implied = found["accepted_count"] or (found["submitted_count"] or 0) * (found["rate"] or 0)
            if found["clear"] and dblp and not (0.5 <= implied / dblp <= 2.0):
                found["clear"] = False
            if found["clear"]:
                written += 1
                print(f"  ✓ {venue_id} {year}: accepted {found['accepted_count']} of {found['submitted_count']} "
                      f"submitted, {found['rate']:.1%}  {url}")
                conn.execute(
                    "UPDATE proceedings SET submitted_count = ?, accepted_official = ?, acceptance_rate = ?, "
                    "acceptance_source = ? WHERE venue_id = ? AND year = ?",
                    (found["submitted_count"], found["accepted_count"], found["rate"], url, venue_id, year))
            elif found["submitted"] or found["accepted"]:
                queued += 1
                print(f"  ? {venue_id} {year}: submitted {found['submitted']} accepted {found['accepted']} "
                      f"rates {found['rates']}  (queued)")
                db.propose(conn, "proceedings", f"{venue_id}/{year}", "acceptance",
                           json.dumps({k: found[k] for k in ("submitted", "accepted", "rates")}), url)
            else:
                missing += 1

    print(f"\n{written} rates from official messages · {queued} ambiguous, queued for review · "
          f"{missing} with no message or no figures")
    if not args.write:
        conn.rollback()
        print("(dry run - pass --write to apply)")
        return 0
    conn.commit()
    db.dump(conn)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
