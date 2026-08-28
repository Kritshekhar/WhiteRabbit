#!/usr/bin/env python3
"""Import venues from ccf-deadlines into conferences.yml.

ccf-deadlines (MIT, github.com/ccfddl/ccf-deadlines) is the actively maintained
dataset behind aideadlines.org. It carries links, deadlines and CCF/CORE ranks
for several hundred venues.

Two deliberate limits:

  * Every link is probed before the venue is written. A venue whose link does
    not resolve is skipped, not imported broken.
  * Imported deadlines land as `confirmed: false`. They are second-hand - read
    off an aggregator, not off the venue's own call - and this project's rule is
    that `confirmed` means a human read it on the CFP page. `source` records
    where it came from so the claim is still traceable; run
    scripts/check_deadlines.py afterwards to promote them.

  python scripts/import_ccf.py AI --dry-run
  python scripts/import_ccf.py AI --write
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
CONFIG = ROOT / "conferences.yml"
API = "https://api.github.com/repos/ccfddl/ccf-deadlines/contents/conference/"
RAW = "https://raw.githubusercontent.com/ccfddl/ccf-deadlines/main/conference/"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")

# CORE is the externally sourced opinion we lean on for venues we have no view
# on. A* is the top of the full-paper stage; everything else is the strong-but-
# specialised band. It is deliberately NOT applied to venues already in the file.
CORE_TO_TIER = {"A*": "royal-flush"}
DEFAULT_TIER = "full-house"

# Finer topics than ccf's single "AI" bucket, for the subject filter.
TOPICS = {
    "CVPR": ["CV"], "ICCV": ["CV"], "ECCV": ["CV"], "ACCV": ["CV"], "BMVC": ["CV"],
    "WACV": ["CV"], "ICIP": ["CV"], "ICPR": ["CV"], "FG": ["CV"], "ICDAR": ["CV"],
    "MICCAI": ["CV"], "IJCB": ["CV"], "EUVIP": ["CV"],
    "ACL": ["NLP"], "EMNLP": ["NLP"], "NAACL": ["NLP"], "COLING": ["NLP"],
    "EACL": ["NLP"], "CoNLL": ["NLP"], "IJCNLP": ["NLP"], "LREC": ["NLP"],
    "NeurIPS": ["ML"], "ICML": ["ML"], "ICLR": ["ML"], "AISTATS": ["ML"],
    "COLT": ["ML"], "UAI": ["ML"], "ALT": ["ML"], "ACML": ["ML"], "COLM": ["ML"],
    "CPAL": ["ML"], "ESANN": ["ML"], "ICANN": ["ML"], "ICONIP": ["ML"],
    "AAAI": ["AI"], "IJCAI": ["AI"], "ECAI": ["AI"], "KR": ["AI"], "ICAPS": ["AI"],
    "AAMAS": ["AI"], "ICCBR": ["AI"], "ICTAI": ["AI"], "DAI": ["AI"], "CICAI": ["AI"],
    "ICRA": ["RO"], "IROS": ["RO"], "CoRL": ["RO"], "RSS": ["RO"],
    "GECCO": ["ML"], "PPSN": ["ML"], "CEC": ["ML"],
}

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096
yaml.indent(mapping=2, sequence=4, offset=2)


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", "ignore")


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


def offset_for(timezone: str) -> str:
    """ccf writes 'AoE', 'UTC+0', 'UTC-12'. AoE is UTC-12."""
    tz = (timezone or "").strip()
    if not tz or tz.upper() == "AOE":
        return "-12:00"
    m = re.match(r"(?i)utc([+-])(\d{1,2})", tz)
    if not m:
        return "-12:00"
    sign, hours = m.group(1), int(m.group(2))
    return f"{sign}{hours:02d}:00"


def to_iso(stamp: str, timezone: str) -> str | None:
    stamp = str(stamp or "").strip()
    if not stamp or not stamp[:4].isdigit():
        return None
    try:
        dt = datetime.datetime.strptime(stamp[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + offset_for(timezone)


def template_for(link: str, year) -> str:
    """Only when the four-digit year is literally in the URL.

    Guessing a two-digit substitution invites replacing an unrelated number and
    rolling a venue onto a URL that never existed, so we simply do not.
    """
    if not year or str(year) not in (link or ""):
        return ""
    return link.replace(str(year), "{year}")


def probe(url: str) -> str:
    if not url:
        return "unknown"
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(url, method=method, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return "ok" if 200 <= resp.status < 400 else "dead"
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 405, 406, 429):
                continue
            return "dead" if exc.code in (404, 410) else "unknown"
        except Exception:
            continue
    return "unknown"


def fetch_category(cat: str) -> list[dict]:
    files = [f["name"] for f in json.loads(get(API + cat))
             if f["name"].endswith(".yml") and f["name"] != "types.yml"]
    safe = YAML(typ="safe")

    def load(name):
        try:
            return safe.load(get(f"{RAW}{cat}/{name}")), name
        except Exception:
            return None, name

    out = []
    with concurrent.futures.ThreadPoolExecutor(10) as pool:
        for doc, name in pool.map(load, files):
            for entry in (doc or []):
                confs = entry.get("confs") or []
                if not confs:
                    continue
                latest = max(confs, key=lambda c: c.get("year", 0))
                timeline = (latest.get("timeline") or [{}])[0]
                out.append({
                    "title": entry.get("title"),
                    "full_name": entry.get("description", "") or "",
                    "core": (entry.get("rank") or {}).get("core", "") or "",
                    "ccf": (entry.get("rank") or {}).get("ccf", "") or "",
                    "year": latest.get("year"),
                    "link": (latest.get("link") or "").strip(),
                    "timezone": latest.get("timezone", ""),
                    "deadline": timeline.get("deadline"),
                    "abstract": timeline.get("abstract_deadline"),
                    "file": f"{cat}/{name}",
                })
    return out


def to_venue(v: dict) -> dict:
    tier = CORE_TO_TIER.get(v["core"], DEFAULT_TIER)
    source = f"https://github.com/ccfddl/ccf-deadlines/blob/main/conference/{v['file']}"
    deadlines = []
    if abstract := to_iso(v["abstract"], v["timezone"]):
        deadlines.append({"name": "Abstract", "date": abstract,
                          "confirmed": False, "source": source})
    if deadline := to_iso(v["deadline"], v["timezone"]):
        deadlines.append({"name": "Paper submission", "date": deadline,
                          "confirmed": False, "source": source})
    if not deadlines:
        deadlines.append({"name": "Paper submission", "date": None, "confirmed": False})

    venue = {"name": v["title"]}
    if v["full_name"]:
        venue["full_name"] = v["full_name"]
    venue["tier"] = tier
    venue["url"] = v["link"]
    if template := template_for(v["link"], v["year"]):
        venue["url_template"] = template
    if v["year"]:
        venue["year"] = v["year"]
    if topics := TOPICS.get(str(v["title"])):
        venue["topics"] = topics
    venue["notes"] = f"CORE {v['core'] or 'unranked'} · CCF {v['ccf'] or 'unranked'}. Imported from ccf-deadlines."
    venue["deadlines"] = deadlines
    return venue


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("categories", nargs="*", default=["AI"],
                    help="ccf-deadlines categories, e.g. AI DB NW SC SE")
    ap.add_argument("--write", action="store_true", help="write conferences.yml")
    ap.add_argument("--dry-run", action="store_true", help="report only (default)")
    args = ap.parse_args()

    config = yaml.load(CONFIG.read_text(encoding="utf-8"))
    existing = {slugify(v.get("name")) for v in config["venues"]}

    candidates = []
    for cat in (args.categories or ["AI"]):
        print(f"fetching {cat} ...", file=sys.stderr)
        candidates += fetch_category(cat)

    fresh = [v for v in candidates if slugify(v["title"]) not in existing]
    dupes = len(candidates) - len(fresh)

    print(f"probing {len(fresh)} links ...", file=sys.stderr)
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        statuses = list(pool.map(probe, (v["link"] for v in fresh)))

    keep, dropped = [], []
    for v, status in zip(fresh, statuses):
        (keep if status == "ok" else dropped).append((v, status))

    for v, status in dropped:
        print(f"  skipped {v['title']}: link {status} ({v['link']})")

    print(f"\n{len(candidates)} found · {dupes} already tracked · "
          f"{len(dropped)} skipped for a bad link · {len(keep)} to add")
    tiers = {}
    for v, _ in keep:
        t = CORE_TO_TIER.get(v["core"], DEFAULT_TIER)
        tiers[t] = tiers.get(t, 0) + 1
    print("stages:", tiers)

    if not args.write:
        print("\n(dry run - pass --write to apply)")
        return 0

    for v, _ in keep:
        config["venues"].append(to_venue(v))
    buf = io.StringIO()
    yaml.dump(config, buf)
    CONFIG.write_text(buf.getvalue(), encoding="utf-8")
    print(f"\nAdded {len(keep)} venues to {CONFIG.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
