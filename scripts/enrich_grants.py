#!/usr/bin/env python3
"""Read each federal solicitation in full, and record what it funds and for how much.

grants.gov's fetchOpportunity returns the whole synopsis, not the one-line
summary the search endpoint gives, plus the money fields (ceiling, floor, total
programme funding, expected number of awards) and a link to the agency's own
solicitation. That is the text a classification should be made from.

Writes two things to the database:
  solicitations   the full text, for classification and re-reading
  grants          funding figures merged into each entry (with --write)

Classification itself is not automated here: a keyword vote would put every
"AI for X" programme in the same bucket regardless of what it actually funds.
The corpus this produces is what a human (or a model) reads to decide.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import html
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

def fetch(opportunity_id: str) -> dict | None:
    body = json.dumps({"opportunityId": int(opportunity_id)}).encode()
    req = urllib.request.Request(API, data=body, headers={
        "Content-Type": "application/json", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            payload = json.loads(resp.read().decode("utf-8", "ignore"))
    except Exception:
        return None
    return payload.get("data") if payload.get("errorcode") == 0 else None


def plain(markup: str) -> str:
    text = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", markup or "")
    text = html.unescape(re.sub(r"(?s)<[^>]+>", " ", text))
    return re.sub(r"[ \t\xa0]+", " ", text).strip()


def money(value) -> int | None:
    """grants.gov sends these as numbers or as strings; 0 means 'not stated'."""
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        return None
    return n or None


def human(n: int | None) -> str:
    if not n:
        return ""
    if n >= 1_000_000:
        return f"${n / 1_000_000:.1f}M".replace(".0M", "M")
    if n >= 1_000:
        return f"${n // 1000}k"
    return f"${n}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="merge funding figures into the grants")
    args = ap.parse_args()

    conn = db.connect()
    grants = conn.execute("SELECT id, name, url FROM grants ORDER BY position").fetchall()

    targets = []
    for g in grants:
        m = re.search(r"grants\.gov/search-results-detail/(\d+)", g["url"])
        if m:
            targets.append((g, m.group(1)))
    print(f"reading {len(targets)} federal solicitations "
          f"({len(grants) - len(targets)} non-federal, skipped)", file=sys.stderr)

    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        records = list(pool.map(lambda t: fetch(t[1]), targets))

    corpus, funded = {}, 0
    for (g, oid), record in zip(targets, records):
        if not record:
            continue
        syn = record.get("synopsis") or {}
        ceiling = money(syn.get("awardCeiling"))
        floor = money(syn.get("awardFloor"))
        total = money(syn.get("estimatedFunding"))
        awards = money(syn.get("numberOfAwards"))

        # one opportunity can be listed under two names; keep the first
        corpus.setdefault(oid, (g["name"], syn.get("agencyName") or "", record.get("opportunityNumber") or "",
                                syn.get("responseDate"), (syn.get("fundingDescLinkUrl") or "").strip(),
                                ceiling, floor, total, awards,
                                plain(syn.get("synopsisDesc") or "")[:12000]))

        parts = []
        if total:
            parts.append(f"{human(total)} total")
        if awards:
            parts.append(f"{awards} award{'s' if awards != 1 else ''}")
        if ceiling:
            parts.append(f"up to {human(ceiling)} each")
        if parts and args.write:
            funding = {k: v for k, v in {
                "total_program": total, "award_ceiling": ceiling,
                "award_floor": floor, "expected_awards": awards}.items() if v}
            conn.execute("UPDATE grants SET amount = ?, funding = ? WHERE id = ?",
                         (" · ".join(parts), db.jdump(funding), g["id"]))
        if parts:
            funded += 1

    conn.execute("DELETE FROM solicitations")
    for i, (oid, row) in enumerate(corpus.items()):
        conn.execute(
            "INSERT INTO solicitations (id, position, name, agency, opportunity_number, close, solicitation, "
            "award_ceiling, award_floor, total_program_funding, expected_awards, description) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (oid, i, *row))
    conn.commit()
    db.dump(conn)
    print(f"stored {len(corpus)} solicitations "
          f"({sum(len(r[-1]) for r in corpus.values()):,} chars of text)")
    print(f"{funded} grants {'gained' if args.write else 'would gain'} funding figures")
    if not args.write:
        print("(dry run for funding - pass --write to merge it into the grants)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
