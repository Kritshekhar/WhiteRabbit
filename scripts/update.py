#!/usr/bin/env python3
"""Build the dashboard data file from conferences.yml.

Run nightly by .github/workflows/update-deadlines.yml, and on every push that
touches the config.

What it does
  1. Reads conferences.yml (the single source of truth).
  2. Fills in defaults, so a brand-new entry needs nothing but a `name`.
  3. Rolls a venue over to next year's site once its cycle is done and the new
     page is actually live (see roll_over_cycle).
  4. Probes every link so the dashboard can flag dead URLs.
  5. Writes data/deadlines.json for the front-end.

Usage
  python scripts/update.py                 # full run (network probes on)
  python scripts/update.py --no-network    # offline: rebuild JSON only
  python scripts/update.py --dry-run       # print what would change
"""

from __future__ import annotations

import argparse
import io
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
CONFIG = ROOT / "conferences.yml"
OUTPUT = ROOT / "data" / "deadlines.json"

UA = "conference-deadline-dashboard/1.0 (+https://github.com/)"
TIMEOUT = 15
MAX_PROBE_WORKERS = 8
VALID_TIERS = {"tier1", "companion", "workshop"}

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096
yaml.indent(mapping=2, sequence=4, offset=2)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def parse_date(value):
    """Accept ISO strings and bare dates; return an aware datetime or None."""
    if value in (None, "", "TBA", "tba"):
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            print(f"  ! unparseable date: {value!r}", file=sys.stderr)
            return None
    if dt.tzinfo is None:
        # Bare dates are treated as AoE end-of-day, the academic convention.
        dt = dt.replace(hour=23, minute=59, tzinfo=timezone(timedelta(hours=-12)))
    return dt


def shift_year(dt: datetime, delta: int = 1) -> datetime:
    try:
        return dt.replace(year=dt.year + delta)
    except ValueError:  # Feb 29 in a non-leap year
        return dt.replace(year=dt.year + delta, day=28)


def render_template(template: str, year: int) -> str:
    return (
        template.replace("{year}", str(year))
        .replace("{yyyy}", str(year))
        .replace("{yy}", f"{year % 100:02d}")
        .replace("{yyn}", f"{(year + 1) % 100:02d}")
    )


def probe(url: str) -> str:
    """Return 'ok', 'dead' or 'unknown' for a URL."""
    if not url:
        return "unknown"
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(url, method=method, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return "ok" if 200 <= resp.status < 400 else "dead"
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 405, 406, 429):
                continue  # bot-blocked or method not allowed -> retry as GET
            return "dead" if exc.code in (404, 410) else "unknown"
        except Exception:
            continue
    return "unknown"


def page_mentions_year(url: str, year: int) -> bool:
    """Soft-404 guard for rollover.

    Several conference hosts answer 200 for any year you ask for and quietly
    serve an old edition (sigops.org/s/conferences/sosp/2099/ happily returns
    the SOSP 2017 page). A real next-cycle site always names its own year, so
    require that before touching the config.
    """
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = resp.read(400_000).decode("utf-8", "ignore")
    except Exception:
        return False
    return str(year) in body


# --------------------------------------------------------------------------
# normalisation — every optional field gets a sane default here
# --------------------------------------------------------------------------
def normalise(raw: dict) -> dict:
    name = str(raw.get("name") or "").strip()
    if not name:
        raise ValueError(f"venue entry is missing `name`: {raw!r}")

    tier = str(raw.get("tier") or "companion").strip().lower()
    if tier not in VALID_TIERS:
        print(f"  ! {name}: unknown tier {tier!r}, treating as companion", file=sys.stderr)
        tier = "companion"

    deadlines = []
    for entry in raw.get("deadlines") or []:
        if isinstance(entry, (str, datetime)):  # shorthand: a bare date
            entry = {"name": "Paper submission", "date": entry}
        dt = parse_date(entry.get("date"))
        deadlines.append(
            {
                "name": str(entry.get("name") or "Paper submission"),
                "date": dt.isoformat() if dt else None,
                "confirmed": bool(entry.get("confirmed", False)),
                "_dt": dt,
            }
        )
    deadlines.sort(key=lambda d: (d["_dt"] is None, d["_dt"] or datetime.max.replace(tzinfo=timezone.utc)))

    return {
        "id": slugify(name),
        "name": name,
        "full_name": str(raw.get("full_name") or "").strip(),
        "tier": tier,
        "url": str(raw.get("url") or "").strip(),
        "url_template": str(raw.get("url_template") or "").strip(),
        "year": raw.get("year"),
        "month": raw.get("month"),
        "rolling": bool(raw.get("rolling", False)),
        "notes": str(raw.get("notes") or "").strip(),
        "deadlines": deadlines,
    }


# --------------------------------------------------------------------------
# year rollover
# --------------------------------------------------------------------------
def roll_over_cycle(raw, venue, now, grace_days, allow_network) -> bool:
    """Bump a venue to next year's site once this cycle is over.

    Returns True if conferences.yml was modified. Deliberately conservative:
    we only move when the next-year page answers 200, so a venue that has not
    published its site yet simply stays put and is retried tomorrow.
    """
    template, year = venue["url_template"], venue["year"]
    if venue["rolling"] or not template or not isinstance(year, int):
        return False

    dated = [d["_dt"] for d in venue["deadlines"] if d["_dt"]]
    if not dated:
        return False
    if now < max(dated) + timedelta(days=grace_days):
        return False  # cycle still running

    next_year = year + 1
    next_url = render_template(template, next_year)
    if not allow_network:
        print(f"  - {venue['name']}: cycle over, would probe {next_url}")
        return False
    if probe(next_url) != "ok" or not page_mentions_year(next_url, next_year):
        print(f"  - {venue['name']}: {next_year} site not live yet ({next_url})")
        return False

    raw["year"] = next_year
    raw["url"] = next_url
    for entry in raw.get("deadlines") or []:
        dt = parse_date(entry.get("date") if isinstance(entry, dict) else entry)
        if not isinstance(entry, dict) or dt is None:
            continue
        entry["date"] = shift_year(dt).isoformat()
        entry["confirmed"] = False  # shifted dates are estimates until verified
    print(f"  * {venue['name']}: rolled over to {next_year} -> {next_url}")
    return True


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-network", action="store_true", help="skip all HTTP probes")
    ap.add_argument("--dry-run", action="store_true", help="do not write any file")
    args = ap.parse_args()

    allow_network = not args.no_network
    now = datetime.now(timezone.utc)

    config = yaml.load(CONFIG.read_text(encoding="utf-8"))
    settings = config.get("settings") or {}
    grace_days = int(settings.get("grace_days", 21))
    aoe_label = str(settings.get("aoe_label", "AoE"))

    raw_venues = config.get("venues") or []
    print(f"Loaded {len(raw_venues)} venues from {CONFIG.name}")

    config_changed = False
    venues, seen = [], set()

    for raw in raw_venues:
        venue = normalise(raw)
        if venue["id"] in seen:
            print(f"  ! duplicate venue {venue['name']!r}, skipping", file=sys.stderr)
            continue
        seen.add(venue["id"])

        if roll_over_cycle(raw, venue, now, grace_days, allow_network):
            config_changed = True
            venue = normalise(raw)  # re-read the bumped values

        for d in venue["deadlines"]:
            d.pop("_dt", None)
        venues.append(venue)

    # Link health for every venue, checked concurrently - 37 sequential probes
    # with a 15s timeout is a slow way to run a nightly job.
    if allow_network:
        with concurrent.futures.ThreadPoolExecutor(MAX_PROBE_WORKERS) as pool:
            for venue, status in zip(venues, pool.map(probe, (v["url"] for v in venues))):
                venue["link_status"] = status
        dead = [v["name"] for v in venues if v["link_status"] == "dead"]
        if dead:
            print(f"  ! dead links: {', '.join(dead)}", file=sys.stderr)
    else:
        for venue in venues:
            venue["link_status"] = "unknown"

    payload = {
        "generated_at": now.replace(microsecond=0).isoformat(),
        "aoe_label": aoe_label,
        "counts": {
            "total": len(venues),
            "tier1": sum(v["tier"] == "tier1" for v in venues),
            "companion": sum(v["tier"] == "companion" for v in venues),
            "workshop": sum(v["tier"] == "workshop" for v in venues),
        },
        "venues": venues,
    }

    if args.dry_run:
        print(json.dumps(payload["counts"], indent=2))
        print(f"(dry run) config_changed={config_changed}")
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT.relative_to(ROOT)} ({len(venues)} venues)")

    if config_changed:
        buf = io.StringIO()
        yaml.dump(config, buf)
        CONFIG.write_text(buf.getvalue(), encoding="utf-8")
        print("Updated conferences.yml (year rollover)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
