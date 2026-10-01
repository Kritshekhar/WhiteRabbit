#!/usr/bin/env python3
"""Verify federal grant deadlines against grants.gov's own record.

The imported dates come from the Search2 list endpoint, which is a summary.
fetchOpportunity returns the authoritative record for one opportunity: its
`responseDate`, and `fundingDescLinkUrl`, which points at the funding agency's
own solicitation document.

That distinction matters for the confirmed/estimated rule. grants.gov is not a
third-party aggregator scraping other people's pages - it is the federal
government's own publication system for these programmes, and the link it hands
back is the agency's solicitation. A date read from there is first-party, so it
earns `confirmed: true` with the solicitation as its source.

Fellowships are not federal and have no equivalent record, so this leaves them
alone. They need a human on the funder's page.

Only unverified deadlines are fetched (the needs_check view). Once a date is
verified it is final and never re-fetched.

  python scripts/verify_grants.py --dry-run
  python scripts/verify_grants.py --write
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402

API = "https://api.grants.gov/v1/api/fetchOpportunity"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")

# "Oct 09, 2026 12:00:00 AM EDT"
STAMP = re.compile(r"^([A-Za-z]{3} \d{2}, \d{4})")
OFFSETS = {"EST": "-05:00", "EDT": "-04:00", "CST": "-06:00", "CDT": "-05:00",
           "MST": "-07:00", "MDT": "-06:00", "PST": "-08:00", "PDT": "-07:00"}


def fetch(opportunity_id: str) -> dict | None:
    body = json.dumps({"opportunityId": int(opportunity_id)}).encode()
    req = urllib.request.Request(
        API, data=body,
        headers={"Content-Type": "application/json", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            payload = json.loads(resp.read().decode("utf-8", "ignore"))
    except Exception:
        return None
    return payload.get("data") if payload.get("errorcode") == 0 else None


def to_iso(response_date: str) -> str | None:
    """Date only, at end of day in the stated zone.

    grants.gov prints midnight, which is the start of the closing day rather
    than the moment a proposal is due, so taking it literally would show a
    deadline a day early. NSF's real rule is 5 p.m. submitter's local time,
    which no single offset can express - the note on the card says so.
    """
    match = STAMP.match(response_date or "")
    if not match:
        return None
    try:
        day = datetime.datetime.strptime(match.group(1), "%b %d, %Y").date()
    except ValueError:
        return None
    zone = (response_date.strip().rsplit(" ", 1) or ["", ""])[-1]
    return f"{day.isoformat()}T23:59:00{OFFSETS.get(zone, '-05:00')}"


RULE = "Federal proposals are due 5 p.m. submitter's local time on the closing date."


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    conn = db.connect()
    pending = conn.execute(
        "SELECT gd.id AS deadline_id, gd.date, g.id, g.name, g.url, g.notes "
        "FROM needs_check n JOIN grant_deadlines gd ON n.entity = 'grant_deadline' "
        "AND gd.id = CAST(n.entity_id AS INTEGER) JOIN grants g ON g.id = gd.grant_id "
        "WHERE gd.position = 0 ORDER BY g.position").fetchall()
    total = conn.execute("SELECT count(*) FROM grants").fetchone()[0]

    targets = []
    for row in pending:
        m = re.search(r"grants\.gov/search-results-detail/(\d+)", row["url"])
        if m:
            targets.append((row, m.group(1)))

    print(f"{len(targets)} unverified federal opportunities to check "
          f"({total - len(pending)} already verified, "
          f"{len(pending) - len(targets)} non-federal, left alone)", file=sys.stderr)

    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        records = list(pool.map(lambda t: fetch(t[1]), targets))

    confirmed = changed = missing = rolling = 0
    today = datetime.date.today()
    for (row, oid), record in zip(targets, records):
        db.log_fetch(conn, f"{API}#{oid}", 200 if record else None)
        if not record:
            missing += 1
            continue
        syn = record.get("synopsis") or {}
        iso = to_iso(syn.get("responseDate") or "")
        if not iso:
            missing += 1
            continue
        # the agency's own solicitation, when grants.gov links one
        solicitation = (syn.get("fundingDescLinkUrl") or "").strip()
        source = solicitation or row["url"]
        note = row["notes"]

        # grants.gov parks continuing programmes on a placeholder decades out
        # (2076 shows up). A fifty-year countdown is noise, so treat anything
        # implausibly far away as "no announced date" rather than a deadline.
        horizon = today + datetime.timedelta(days=5 * 365)
        if datetime.date.fromisoformat(iso[:10]) > horizon:
            conn.execute("UPDATE grant_deadlines SET date = NULL WHERE id = ?", (row["deadline_id"],))
            if "no fixed deadline" not in note:
                note = (note + " grants.gov lists no fixed deadline for this "
                        "programme; proposals are accepted on a rolling basis.").strip()
                conn.execute("UPDATE grants SET notes = ? WHERE id = ?", (note, row["id"]))
            rolling += 1
            print(f"  = {row['name'][:52]:<54} {iso[:10]} looks like a placeholder -> rolling")
            continue

        if str(row["date"])[:10] != iso[:10]:
            changed += 1
            print(f"  ~ {row['name'][:52]:<54} {str(row['date'])[:10]} -> {iso[:10]}")
        conn.execute("UPDATE grant_deadlines SET date = ?, status = 'verified', source = ?, verified_on = ? "
                     "WHERE id = ?", (iso, source, today.isoformat(), row["deadline_id"]))
        if solicitation:
            conn.execute("UPDATE grants SET solicitation = ? WHERE id = ?", (solicitation, row["id"]))
        if "5 p.m." not in note:
            conn.execute("UPDATE grants SET notes = ? WHERE id = ?", ((note + " " + RULE).strip(), row["id"]))
        confirmed += 1

    print(f"\n{confirmed} verified against grants.gov's own record · "
          f"{changed} dates corrected · {rolling} placeholder dates cleared · "
          f"{missing} without a usable record")

    if not args.write:
        conn.rollback()
        print("(dry run - pass --write to apply)")
        return 0

    conn.commit()
    db.dump(conn)
    print("Updated the database")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
