#!/usr/bin/env python3
"""Build data/grants.json from grants.yml.

Mirrors scripts/update.py: normalise, probe every link, write JSON. Countdowns
are computed in the browser from the ISO dates, so this never stores day counts.

  python scripts/update_grants.py               # probe links
  python scripts/update_grants.py --no-network  # rebuild JSON only
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ruamel.yaml import YAML

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "grants.yml"
OUTPUT = ROOT / "data" / "grants.json"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
TIMEOUT = 15
WORKERS = 8
ELIGIBILITY = ["PhD student", "Postdoc", "Early-career faculty", "Faculty / PI"]

yaml = YAML(typ="safe")


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")


def parse_date(value):
    if value in (None, "", "TBA"):
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        print(f"  ! unparseable date: {value!r}", file=sys.stderr)
        return None
    if dt.tzinfo is None:
        dt = dt.replace(hour=23, minute=59, tzinfo=timezone(timedelta(hours=-5)))
    return dt


def probe(url: str) -> str:
    if not url:
        return "unknown"
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(url, method=method, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return "ok" if 200 <= resp.status < 400 else "dead"
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 405, 406, 429):
                continue
            return "dead" if exc.code in (404, 410) else "unknown"
        except Exception:
            continue
    return "unknown"


def normalise(raw: dict) -> dict:
    name = str(raw.get("name") or "").strip()
    if not name:
        raise ValueError(f"grant entry is missing `name`: {raw!r}")

    eligibility = str(raw.get("eligibility") or "Faculty / PI").strip()
    if eligibility not in ELIGIBILITY:
        print(f"  ! {name}: unknown eligibility {eligibility!r}", file=sys.stderr)

    deadlines = []
    for entry in raw.get("deadlines") or []:
        dt = parse_date(entry.get("date"))
        deadlines.append({
            "name": str(entry.get("name") or "Application"),
            "date": dt.isoformat() if dt else None,
            "confirmed": bool(entry.get("confirmed", False)),
            "source": str(entry.get("source") or "").strip(),
        })
    deadlines.sort(key=lambda d: (d["date"] is None, d["date"] or ""))

    return {
        "id": slugify(name),
        "name": name,
        "funder": str(raw.get("funder") or "").strip(),
        "also_funded_by": [str(f) for f in (raw.get("also_funded_by") or [])],
        "eligibility": eligibility,
        "url": str(raw.get("url") or "").strip(),
        "amount": str(raw.get("amount") or "").strip(),
        "opportunity_number": str(raw.get("opportunity_number") or "").strip(),
        "topics": [str(t).strip() for t in (raw.get("topics") or []) if str(t).strip()],
        "notes": str(raw.get("notes") or "").strip(),
        "deadlines": deadlines,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-network", action="store_true")
    args = ap.parse_args()
    now = datetime.now(timezone.utc)

    config = yaml.load(CONFIG.read_text(encoding="utf-8"))
    raws = config.get("grants") or []
    print(f"Loaded {len(raws)} grants from {CONFIG.name}")

    grants, seen = [], set()
    for raw in raws:
        g = normalise(raw)
        if g["id"] in seen:
            print(f"  ! duplicate grant {g['name']!r}, skipping", file=sys.stderr)
            continue
        seen.add(g["id"])
        grants.append(g)

    if args.no_network:
        previous = {}
        if OUTPUT.exists():
            try:
                previous = {g["id"]: g for g in json.loads(OUTPUT.read_text())["grants"]}
            except Exception:
                previous = {}
        for g in grants:
            g["link_status"] = previous.get(g["id"], {}).get("link_status", "unknown")
    else:
        print(f"Probing {len(grants)} links ...")
        with concurrent.futures.ThreadPoolExecutor(WORKERS) as pool:
            for g, status in zip(grants, pool.map(probe, (x["url"] for x in grants))):
                g["link_status"] = status
        dead = [g["name"] for g in grants if g["link_status"] == "dead"]
        if dead:
            print(f"  ! dead links ({len(dead)}): {', '.join(dead[:6])}", file=sys.stderr)

    counts = {"total": len(grants)}
    for tier in ELIGIBILITY:
        counts[tier] = sum(1 for g in grants if g["eligibility"] == tier)

    payload = {
        "generated_at": now.replace(microsecond=0).isoformat(),
        "counts": counts,
        "grants": grants,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT.relative_to(ROOT)} ({len(grants)} grants)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
