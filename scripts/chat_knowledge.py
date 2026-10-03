#!/usr/bin/env python3
"""What the White Rabbit chat assistant knows: a compact snapshot of what the
public pages show, written as JSON for the chat Worker (chat/).

Only what a visitor can already read on the site goes in: each venue's
current deadlines with their verified/estimated status, its latest
proceedings size and acceptance rate, and each grant and fellowship with its
deadlines, amount and eligibility. The snapshot is uploaded to the Worker's
private KV store by the deploy job; it is never published on the site.

  python scripts/chat_knowledge.py > knowledge.json
"""

from __future__ import annotations

import json
import sys
from datetime import date, timezone, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402

HOME = "https://kritshekhar.github.io/WhiteRabbit/"

# the same grouping as the site's areas (web/src/lib/areas.ts)
AREAS = {
    "ML": "Machine learning", "AI": "AI and robotics", "RO": "AI and robotics", "CV": "Computer vision",
    "NLP": "Language", "Systems": "Systems", "Storage": "Systems", "Cloud": "Systems", "Performance": "Systems",
    "HPC": "Systems", "Architecture": "Systems", "Distributed": "Systems", "Dependability": "Systems",
    "Networking": "Networking", "Security": "Security", "Data": "Data and databases",
    "Databases": "Data and databases", "Software Engineering": "Software engineering and PL",
    "Languages": "Software engineering and PL", "HCI": "HCI", "Graphics": "Graphics and multimedia",
    "Theory": "Theory",
}


def deadlines(rows: list[dict]) -> list[list]:
    """[name, ISO instant, verified] for each dated deadline."""
    return [[d["name"], d["date"], bool(d.get("confirmed"))] for d in rows if d.get("date")]


def build(conn) -> dict:
    latest, rated = {}, {}
    for r in conn.execute("SELECT venue_id, year, accepted_count, acceptance_rate, acceptance_kind "
                          "FROM proceedings WHERE accepted_count IS NOT NULL ORDER BY year"):
        latest[r["venue_id"]] = r                      # the most recent year counted
        if r["acceptance_rate"] is not None:
            rated[r["venue_id"]] = r                   # the most recent year with a rate

    venues = []
    for v in db.venue_records(conn):
        p = latest.get(v["id"])
        rec = {
            "id": v["id"], "name": v["name"], "full": v["full_name"],
            "area": AREAS.get((v["topics"] or [""])[0], "Interdisciplinary"),
            "topics": v["topics"], "publisher": v["publisher"], "edition": v["year"],
            "rolling": v["rolling"], "deadlines": deadlines(v["deadlines"]),
            "page": f"{HOME}conferences/{v['id']}/", "official": v["url"],
        }
        if p:
            rec["papers"] = {"year": p["year"], "count": p["accepted_count"]}
        if v["id"] in rated:
            a = rated[v["id"]]
            rec["acceptance"] = {"year": a["year"], "rate": round(a["acceptance_rate"], 3), "kind": a["acceptance_kind"]}
        venues.append(rec)

    grants = []
    for g in db.grant_records(conn):
        grants.append({
            "id": g["id"], "name": g["name"], "funder": g["funder"],
            "kind": "fellowship" if g["eligibility"] == "PhD student" else "grant",
            "eligibility": g["eligibility"], "amount": g["amount"], "topics": g["topics"],
            "window": g.get("typical_window") or "", "deadlines": deadlines(g["deadlines"]),
            "page": f"{HOME}grants/{g['id']}/", "official": g["url"],
        })
    return {"built": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "today": date.today().isoformat(), "venues": venues, "grants": grants}


if __name__ == "__main__":
    json.dump(build(db.connect()), sys.stdout, ensure_ascii=False, separators=(",", ":"))
