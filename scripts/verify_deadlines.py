#!/usr/bin/env python3
"""Verify conference deadlines against each venue's own official page.

A deadline is marked verified only when ALL of these hold:

  * the page is the venue's own site (its `url`, a CFP or dates page under it,
    or the researchr schedule the venue itself runs on)
  * the page is about this edition: it mentions the cycle year
  * a line on that page names the same kind of deadline (abstract, paper
    submission, ...) and states exactly our date, as the latest date on that
    line, so an extended deadline beats the original it replaced
  * any year written on that line is the deadline's year

That is the same check a person makes when they open the CFP and read the
date, done the same way every time. Stale pages are the trap this guards
against: NDSS's 2027 page served 2024 dates, SIGCOMM's 2027 site the 2026 call.
Neither would pass, since their lines do not state our date for our year.

When the page states a different date for the same kind of deadline, nothing
is changed: the date goes to the candidates queue (`wr.py queue`) for a
person to confirm, because one regex is not enough to overwrite a deadline.

Only unverified deadlines of the current cycle are visited; verified ones are
final and never fetched again.

  python scripts/verify_deadlines.py --dry-run
  python scripts/verify_deadlines.py --write
  python scripts/verify_deadlines.py --write fast osdi     # just these venues
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
from check_deadlines import SUBPAGES, fetch, researchr_dates, to_text  # noqa: E402
from render_check import find_chrome, render  # noqa: E402

CHROME = None   # set by --render: headless Chrome for pages that need JavaScript
RENDER_PATHS = ["", "cfp", "call-for-papers", "dates", "important-dates"]

WORKERS = 8
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
MON = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
DATE_PATTERNS = [
    # September 17, 2026 / Sep 17th 2026 / September 17
    re.compile(rf"(?i)\b{MON}\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?\b"),
    # 17 September 2026 / 17th Sept, 2026
    re.compile(rf"(?i)\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?{MON},?(?:\s+(20\d\d))?\b"),
    # 2026-09-17 / 2026/09/17
    re.compile(r"\b(20\d\d)[-/](\d{1,2})[-/](\d{1,2})\b"),
]
KIND_WORDS = {
    "abstract": re.compile(r"(?i)\b(abstract|registration|register|title)"),
    "paper": re.compile(r"(?i)\b(paper|submission|submit|full|manuscript)"),
}
# lines that carry a date but are not the submission deadline
NOT_A_DEADLINE = re.compile(
    r"(?i)\b(notification|camera|rebuttal|author response|decision|conference|workshop dates?|"
    r"registration opens|early registration|travel|grant|visa|program|keynote|tutorial)\b")


# a line about another track says nothing about the main deadline
OTHER_TRACK = re.compile(
    r"(?i)\b(industry|industrial|demo|demonstration|poster|workshop|short paper|doctoral|phd forum|"
    r"artifact|tutorial|student|journal[- ]first|shepherd|tool paper|position paper|late[- ]breaking)\b")


def kind_of(name: str) -> str:
    return "abstract" if re.search(r"(?i)abstract|registration|title", name) else "paper"


def dates_in(line: str) -> list[tuple[date, bool]]:
    """Every date written on a line, with whether its year was explicit."""
    out = []
    for pat in DATE_PATTERNS:
        for m in pat.finditer(line):
            g = m.groups()
            try:
                if pat is DATE_PATTERNS[2]:
                    out.append((date(int(g[0]), int(g[1]), int(g[2])), True))
                    continue
                if pat is DATE_PATTERNS[0]:
                    mon, day, year = g[0], g[1], g[2]
                else:
                    day, mon, year = g[0], g[1], g[2]
                month = MONTHS[mon[:3].lower()]
                out.append((date(int(year) if year else 1900, month, int(day)), bool(year)))
            except (ValueError, KeyError):
                continue
    return out


def candidate_pages(url: str) -> list[tuple[str, str]]:
    """(page url, page text) for the venue's own pages that could carry dates."""
    pages = []
    lines, source = researchr_dates(url)
    if lines:
        pages.append((source, "\n".join(lines)))
    base = url.rstrip("/")
    for target in [url] + [f"{base}/{s}" for s in SUBPAGES]:
        markup = fetch(target)
        if markup:
            pages.append((target, to_text(markup)))
        if len(pages) >= 4:
            break
    # Plenty of venue sites render their dates with JavaScript, so a plain
    # fetch sees an empty shell. Render those in a real browser.
    if CHROME and not any(re.search(r"(?i)deadline|submission", t) for _, t in pages):
        for suffix in RENDER_PATHS:
            target = f"{base}/{suffix}" if suffix else url
            markup = render(CHROME, target)
            if markup:
                pages.append((target, to_text(markup)))
    return pages


def check_venue(venue: dict, deadlines: list[dict]) -> tuple[dict, list, list]:
    """Returns (venue, [(deadline id, source)], [(deadline id, proposed iso, source)])."""
    verified, proposals = [], []
    pages = candidate_pages(venue["url"]) if venue["url"] else []
    for d in deadlines:
        ours = date.fromisoformat(d["date"][:10])
        kind = kind_of(d["name"])
        others = set()
        done = False
        for source, text in pages:
            if str(venue["year"]) not in text and str(ours.year) not in text:
                continue                        # not this edition's page
            for raw in text.splitlines():
                line = re.sub(r"\s+", " ", raw).strip()
                if not (6 < len(line) < 240) or not KIND_WORDS[kind].search(line):
                    continue
                if kind == "paper" and KIND_WORDS["abstract"].search(line) and "paper" not in line.lower():
                    continue
                if NOT_A_DEADLINE.search(line) and not re.search(r"(?i)deadline|due|submission", line):
                    continue
                track = f"{d['name']} {d.get('track', '')}"
                other = OTHER_TRACK.search(line)
                if other and not re.search(re.escape(other.group(1)), track, re.I):
                    continue
                found = dates_in(line)
                if not found:
                    continue
                if any(explicit and dt.year != ours.year for dt, explicit in found):
                    continue                    # another year's call
                resolved = [dt.replace(year=ours.year) if not explicit else dt for dt, explicit in found]
                latest = max(resolved)
                if latest == ours:
                    verified.append((d["id"], source))
                    done = True
                    break
                # a proposal needs a line that is itself about a deadline, not a
                # news item ("call for papers is posted") or an artifact date
                if len(set(resolved)) == 1 and re.search(r"(?i)deadline|\bdue\b", line) \
                        and not re.search(r"(?i)posted|updated|announced|released", line):
                    others.add((latest, source))
            if done:
                break
        if not done and len({dt for dt, _ in others}) == 1:
            proposed, source = next(iter(others))
            if abs((proposed - ours).days) <= 120:   # a nearby correction, not another round
                iso = proposed.isoformat() + d["date"][10:]
                proposals.append((d["id"], iso, source))
    return venue, verified, proposals


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*", help="venue ids or names to check (default: all)")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--render", action="store_true",
                    help="render pages with headless Chrome when a plain fetch finds no dates")
    args = ap.parse_args()
    global CHROME
    if args.render:
        CHROME = find_chrome()
        if not CHROME:
            print("no Chrome found; continuing without rendering", file=sys.stderr)

    conn = db.connect()
    horizon = (date.today() - timedelta(days=7)).isoformat()
    rows = conn.execute(
        "SELECT d.id, d.name, d.track, d.date, v.id AS venue_id, v.name AS venue, v.url, v.year "
        "FROM needs_check n JOIN deadlines d ON n.entity = 'deadline' AND d.id = CAST(n.entity_id AS INTEGER) "
        "JOIN venues v ON v.id = d.venue_id WHERE d.date IS NOT NULL AND d.date >= ? ORDER BY v.position",
        (horizon,)).fetchall()
    wanted = {db.slugify(n) for n in args.names}
    by_venue: dict[str, tuple[dict, list]] = {}
    for r in rows:
        if wanted and r["venue_id"] not in wanted:
            continue
        v = {"id": r["venue_id"], "name": r["venue"], "url": r["url"], "year": r["year"]}
        by_venue.setdefault(r["venue_id"], (v, []))[1].append(dict(r))
    total = sum(len(ds) for _, ds in by_venue.values())
    print(f"checking {total} unverified upcoming deadlines at {len(by_venue)} venues", file=sys.stderr)

    today = date.today().isoformat()
    n_ok = n_prop = 0
    with concurrent.futures.ThreadPoolExecutor(WORKERS) as pool:
        for venue, verified, proposals in pool.map(lambda item: check_venue(*item), by_venue.values()):
            for deadline_id, source in verified:
                n_ok += 1
                print(f"  ✓ {venue['name']:<18} deadline {deadline_id} confirmed at {source}")
                conn.execute("UPDATE deadlines SET status = 'verified', source = ?, verified_on = ? WHERE id = ?",
                             (source, today, deadline_id))
            for deadline_id, iso, source in proposals:
                n_prop += 1
                print(f"  ~ {venue['name']:<18} deadline {deadline_id}: page says {iso[:10]}")
                db.propose(conn, "deadline", deadline_id, "date", iso, source)
            db.log_fetch(conn, venue["url"], None)

    print(f"\n{n_ok} verified on the venue's own page · {n_prop} different dates queued for review · "
          f"{total - n_ok - n_prop} not found on the page")
    if not args.write:
        conn.rollback()
        print("(dry run - pass --write to apply)")
        return 0
    conn.commit()
    db.dump(conn)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
