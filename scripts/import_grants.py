#!/usr/bin/env python3
"""Import US federal CS funding opportunities from grants.gov into grants.yml.

grants.gov exposes a free, keyless JSON API (Search2). Its `cfda` filter is the
precise way in: an ALN/CFDA code maps to a funding directorate, so 47.070 is
exactly NSF's Computer and Information Science and Engineering. Keyword search
is far noisier, returning Interior and State Department hits for "computing".

Everything under CISE is CS by definition and comes in whole. The broader codes
(NSF Engineering, Maths, Education, and the DoD offices) fund plenty that is not
CS, so those are kept only when the title reads as computing.

Imported deadlines land as `confirmed: false`, same rule as the conference list:
they are read off an aggregator rather than the program's own solicitation.

  python scripts/import_grants.py --dry-run
  python scripts/import_grants.py --write
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

from ruamel.yaml import YAML

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "grants.yml"
API = "https://api.grants.gov/v1/api/search2"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")

# ALN/CFDA code -> funder label. CISE is taken wholesale; the rest are filtered.
FUNDERS = {
    "47.070": ("NSF CISE", False),
    "47.041": ("NSF Engineering", True),
    "47.049": ("NSF MPS", True),
    "47.076": ("NSF Education", True),
    "47.075": ("NSF SBE", True),
    "12.300": ("ONR", True),
    "12.431": ("Army Research Office", True),
    "12.800": ("AFOSR", True),
    "12.910": ("DARPA", True),
    "81.049": ("DOE Office of Science", True),
}

CS_WORDS = re.compile(
    r"(?i)\b(comput|software|algorithm|cyber|security|privacy|network|robotic|"
    r"artificial intelligence|machine learning|\bAI\b|data science|informatics|"
    r"human[- ]computer|systems|semiconductor|quantum information|"
    r"cyberinfrastructure|information technology)\w*"
)

# Topic tags, so the page can filter the same way the conference list does.
TOPIC_RULES = [
    (re.compile(r"(?i)secur|privacy|cyber|cryptog"), "Security"),
    (re.compile(r"(?i)artificial intelligence|machine learning|\bAI\b|learning"), "AI/ML"),
    (re.compile(r"(?i)robot"), "Robotics"),
    (re.compile(r"(?i)network|wireless|spectrum|communication"), "Networking"),
    (re.compile(r"(?i)quantum"), "Quantum"),
    (re.compile(r"(?i)data|database|inform"), "Data"),
    (re.compile(r"(?i)educat|traineeship|undergraduate|curricul"), "Education"),
    (re.compile(r"(?i)human|social|behavio"), "HCI"),
    (re.compile(r"(?i)system|architect|semiconductor|chip|hardware"), "Systems"),
    (re.compile(r"(?i)infrastructure|facility|instrument"), "Infrastructure"),
]

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096
yaml.indent(mapping=2, sequence=4, offset=2)


def post(body: dict) -> dict:
    req = urllib.request.Request(
        API, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as resp:
        return json.loads(resp.read().decode("utf-8", "ignore"))


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")


def iso(date_text: str) -> str | None:
    """grants.gov writes MM/DD/YYYY. Federal deadlines are 5pm local; without a
    stated zone the safe reading is end of day, so store 23:59 and let the page
    show the date rather than implying a precision we do not have."""
    try:
        d = datetime.datetime.strptime(date_text, "%m/%d/%Y").date()
    except (ValueError, TypeError):
        return None
    return f"{d.isoformat()}T23:59:00-05:00"


def topics_for(title: str) -> list[str]:
    found = [tag for pattern, tag in TOPIC_RULES if pattern.search(title)]
    return found[:3] or ["General"]


def fetch() -> list[dict]:
    out: dict[str, dict] = {}
    for code, (label, needs_filter) in FUNDERS.items():
        try:
            data = post({"rows": 200, "cfda": code,
                         "oppStatuses": "forecasted|posted"}).get("data") or {}
        except Exception as exc:
            print(f"  ! {label}: {exc}", file=sys.stderr)
            continue
        for opp in data.get("oppHits") or []:
            title = opp.get("title") or ""
            if needs_filter and not CS_WORDS.search(title):
                continue
            opp.setdefault("_funders", set()).add(label)
            existing = out.get(opp["id"])
            if existing:
                existing["_funders"].add(label)
            else:
                opp["_funders"] = {label}
                out[opp["id"]] = opp
    return list(out.values())


def to_grant(opp: dict) -> dict:
    title = re.sub(r"\s+", " ", (opp.get("title") or "").strip())
    number = opp.get("number") or ""
    # CISE first when a call is cross-listed, since that is the CS home.
    funders = sorted(opp["_funders"], key=lambda f: (f != "NSF CISE", f))
    grant = {
        "name": title,
        "funder": funders[0],
        "url": f"https://www.grants.gov/search-results-detail/{opp['id']}",
        "opportunity_number": number,
        "eligibility": "Faculty / PI",
        "topics": topics_for(title),
        "source": "https://www.grants.gov/",
        "deadlines": [],
    }
    if len(funders) > 1:
        grant["also_funded_by"] = funders[1:]
    close = iso(opp.get("closeDate") or "")
    grant["deadlines"] = [{
        "name": "Full proposal",
        "date": close,
        "confirmed": False,
        "source": grant["url"],
    }] if close else [{"name": "Full proposal", "date": None, "confirmed": False}]
    if not close:
        grant["notes"] = "No close date published; NSF often accepts these on a rolling window."
    return grant


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print("querying grants.gov ...", file=sys.stderr)
    opps = fetch()
    today = datetime.date.today()

    fresh, expired = [], 0
    for opp in opps:
        close = opp.get("closeDate") or ""
        try:
            if close and datetime.datetime.strptime(close, "%m/%d/%Y").date() < today:
                expired += 1
                continue
        except ValueError:
            pass
        fresh.append(opp)

    config = {"grants": []}
    if CONFIG.exists():
        config = yaml.load(CONFIG.read_text(encoding="utf-8")) or {"grants": []}
    known = {slugify(g.get("name")) for g in (config.get("grants") or [])}

    additions = [to_grant(o) for o in fresh if slugify(o.get("title")) not in known]

    print(f"{len(opps)} matched · {expired} already closed · "
          f"{len(fresh) - len(additions)} already tracked · {len(additions)} to add")
    dated = sum(1 for g in additions if g["deadlines"][0]["date"])
    print(f"of those, {dated} carry a published close date")

    if not args.write:
        print("\n(dry run - pass --write to apply)")
        return 0

    config.setdefault("grants", []).extend(additions)
    buf = io.StringIO()
    yaml.dump(config, buf)
    CONFIG.write_text(buf.getvalue(), encoding="utf-8")
    print(f"\nWrote {len(additions)} grants to {CONFIG.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
