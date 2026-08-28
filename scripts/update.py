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
import concurrent.futures
import hashlib
import io
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

# Several conference hosts (systor.org among them) answer 403 to an obvious
# bot UA, which would show up as a false "not checked" on the dashboard.
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
TIMEOUT = 15
MAX_PROBE_WORKERS = 8
# A venue's stage on a project's path - see journey.html.
VALID_TIERS = {"rabbit-hole", "royal-flush", "full-house", "looking-glass"}
# Older names still parse so an in-flight branch does not break.
LEGACY_TIERS = {
    "tier1": "royal-flush", "companion": "full-house", "workshop": "rabbit-hole",
    "queens-court": "royal-flush", "tea-party": "full-house",
    "caucus-race": "rabbit-hole", "high-card": "rabbit-hole",
    "wild-card": "looking-glass",
}

# A venue's place on a project's path, not a ranking: every project wants a
# stage 1, then a stage 2, then a stage 3. Stage 2 is the only one with grades.
STAGES = {
    "rabbit-hole":   (1, "Rabbit Hole"),
    "royal-flush":   (2, "Wonderland"),
    "full-house":    (2, "Wonderland"),
    "looking-glass": (3, "Looking Glass"),
}

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096
yaml.indent(mapping=2, sequence=4, offset=2)


# --------------------------------------------------------------------------
# probe policy
#
# Link probing is the only slow part of a build, and most links do not change.
# So a nightly run only re-checks what plausibly moved, and everything else
# carries its previous result forward. Countdowns are unaffected either way -
# they are computed in the browser from the ISO dates, not stored here.
# --------------------------------------------------------------------------
def load_previous() -> dict:
    """Last build's results, keyed by venue id, used as a probe cache."""
    if not OUTPUT.exists():
        return {}
    try:
        return {v["id"]: v for v in json.loads(OUTPUT.read_text(encoding="utf-8"))["venues"]}
    except Exception:
        return {}


def should_probe(venue: dict, cached: dict, now: datetime, max_age_days: int) -> str:
    """Return the reason to probe this venue, or '' to reuse the cached result."""
    if not cached:
        return "never checked"
    if cached.get("link_status") != "ok":
        return f"last result was {cached.get('link_status', 'unknown')}"

    # A venue we have not verified may still be moving its CFP page around.
    if any(not d.get("confirmed") for d in venue["deadlines"]):
        return "dates unverified"

    # A finished cycle needs probing so rollover can find next year's site.
    dated = [d["_dt"] for d in venue["deadlines"] if d["_dt"]]
    if venue["url_template"] and dated and now > max(dated):
        return "cycle over, rollover pending"

    # Otherwise re-check on a rota, so every venue is still seen periodically.
    checked = parse_date(cached.get("link_checked_on"))
    if not checked:
        return "no check timestamp"
    age = (now - checked).days
    if age >= max_age_days:
        return f"last checked {age}d ago"
    return ""


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


def looks_like_a_real_site(body: str, year: int) -> bool:
    """Is this an actual conference page, or a 200 that means nothing?

    Two failure modes seen in the wild, both of which answer 200:
      * a stale edition served for any year you ask for
        (sigops.org/s/conferences/sosp/2099/ returns the SOSP 2017 page)
      * an empty autoindex placeholder
        (conferences.sigcomm.org/hotnets/2027/ -> "Index of /hotnets/2027/",
        which even contains the year, in the directory path)
    """
    title = re.search(r"(?is)<title>(.*?)</title>", body)
    if title and re.match(r"\s*(index of |directory listing)", title.group(1), re.I):
        return False
    if len(body) < 1_000:  # a real conference homepage is never this small
        return False
    return str(year) in body


def page_mentions_year(url: str, year: int) -> bool:
    """Soft-404 guard for rollover - see looks_like_a_real_site."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = resp.read(400_000).decode("utf-8", "ignore")
    except Exception:
        return False
    return looks_like_a_real_site(body, year)


# --------------------------------------------------------------------------
# normalisation — every optional field gets a sane default here
# --------------------------------------------------------------------------
def normalise(raw: dict) -> dict:
    name = str(raw.get("name") or "").strip()
    if not name:
        raise ValueError(f"venue entry is missing `name`: {raw!r}")

    tier = str(raw.get("tier") or "full-house").strip().lower()
    tier = LEGACY_TIERS.get(tier, tier)
    if tier not in VALID_TIERS:
        print(f"  ! {name}: unknown tier {tier!r}, treating as full-house", file=sys.stderr)
        tier = "full-house"

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
                "track": str(entry.get("track") or "").strip(),
                "source": str(entry.get("source") or "").strip(),
                "verified_on": str(entry.get("verified_on") or "").strip(),
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
        "stage": STAGES.get(tier, (2, ""))[0],
        "stage_name": STAGES.get(tier, (2, ""))[1],
        "rolling": bool(raw.get("rolling", False)),
        "cycle_years": max(1, int(raw.get("cycle_years", 1) or 1)),
        "formats": [str(f).strip() for f in (raw.get("formats") or []) if str(f).strip()],
        "tracks": [str(t).strip() for t in (raw.get("tracks") or []) if str(t).strip()],
        "notes": str(raw.get("notes") or "").strip(),
        "deadlines": deadlines,
    }


# --------------------------------------------------------------------------
# year rollover
# --------------------------------------------------------------------------
def snapshot(raw: dict) -> dict:
    """Enough of a venue to put it back the way it was."""
    return {
        "year": raw.get("year"),
        "url": raw.get("url"),
        "dates": [e.get("date") for e in (raw.get("deadlines") or []) if isinstance(e, dict)],
        "confirmed": [e.get("confirmed") for e in (raw.get("deadlines") or []) if isinstance(e, dict)],
    }


def restore(raw: dict, snap: dict) -> None:
    raw["year"] = snap["year"]
    raw["url"] = snap["url"]
    entries = [e for e in (raw.get("deadlines") or []) if isinstance(e, dict)]
    for entry, date, confirmed in zip(entries, snap["dates"], snap["confirmed"]):
        entry["date"] = date
        entry["confirmed"] = confirmed


def roll_over_cycle(raw, venue, now, grace_days, allow_network) -> bool:
    """Bump a venue to next year's site once this cycle is over.

    Returns True if conferences.yml was modified. Deliberately conservative:
    we only move when the next-year page answers 200, so a venue that has not
    published its site yet simply stays put and is retried tomorrow.
    """
    template, year = venue["url_template"], venue["year"]
    step = venue["cycle_years"]  # 2 for biennial venues such as HotOS
    if venue["rolling"] or not template or not isinstance(year, int):
        return False

    dated = [d["_dt"] for d in venue["deadlines"] if d["_dt"]]
    if not dated:
        return False
    if now < max(dated) + timedelta(days=grace_days):
        return False  # cycle still running

    next_year = year + step
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
        entry["date"] = shift_year(dt, step).isoformat()
        entry["confirmed"] = False  # shifted dates are estimates until verified
    print(f"  * {venue['name']}: rolled over to {next_year} -> {next_url}")
    return True


# --------------------------------------------------------------------------
# asset cache-busting
# --------------------------------------------------------------------------
PAGES = ("index.html", "journey.html")
ASSETS = ("assets/style.css", "assets/app.js")


def stamp_assets() -> bool:
    """Rewrite ?v= on each asset link to its content hash.

    Without this a returning visitor keeps the CSS and JS their browser cached
    and sees the previous design against the new data - which is exactly how a
    shipped change looks broken to the person who asked for it.
    """
    changed = False
    stamps = {}
    for asset in ASSETS:
        path = ROOT / asset
        if path.exists():
            stamps[asset] = hashlib.sha1(path.read_bytes()).hexdigest()[:8]

    for page in PAGES:
        path = ROOT / page
        if not path.exists():
            continue
        text = original = path.read_text(encoding="utf-8")
        for asset, digest in stamps.items():
            text = re.sub(
                rf'({re.escape(asset)})(\?v=[0-9a-f]+)?"',
                rf'\g<1>?v={digest}"',
                text,
            )
        if text != original:
            path.write_text(text, encoding="utf-8")
            changed = True
    return changed


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-network", action="store_true", help="skip all HTTP probes")
    ap.add_argument("--dry-run", action="store_true", help="do not write any file")
    ap.add_argument("--scope", choices=("auto", "all"), default="auto",
                    help="auto (default): probe only venues that plausibly moved; "
                         "all: re-probe every venue")
    ap.add_argument("--max-age-days", type=int, default=30,
                    help="in auto scope, re-probe a venue this many days after its "
                         "last check (default 30, so everything is still seen monthly)")
    args = ap.parse_args()

    allow_network = not args.no_network
    now = datetime.now(timezone.utc)

    config = yaml.load(CONFIG.read_text(encoding="utf-8"))
    settings = config.get("settings") or {}
    grace_days = int(settings.get("grace_days", 21))
    aoe_label = str(settings.get("aoe_label", "AoE"))

    raw_venues = config.get("venues") or []
    previous = load_previous()
    print(f"Loaded {len(raw_venues)} venues from {CONFIG.name}")

    config_changed = False
    venues, seen = [], set()
    rolled: dict[str, tuple] = {}  # venue id -> (raw entry, pre-rollover snapshot)

    for raw in raw_venues:
        venue = normalise(raw)
        if venue["id"] in seen:
            print(f"  ! duplicate venue {venue['name']!r}, skipping", file=sys.stderr)
            continue
        seen.add(venue["id"])

        before = snapshot(raw)
        if roll_over_cycle(raw, venue, now, grace_days, allow_network):
            config_changed = True
            rolled[slugify(str(raw.get("name")))] = (raw, before)
            venue = normalise(raw)  # re-read the bumped values

        cached = previous.get(venue["id"], {})
        venue["_reason"] = (
            "scope=all" if args.scope == "all"
            else should_probe(venue, cached, now, args.max_age_days)
        )
        venue["_cached"] = cached
        for d in venue["deadlines"]:
            d.pop("_dt", None)
        venues.append(venue)

    # Probe only what needs it, concurrently. Everything else carries its last
    # result forward, so a nightly run touches a handful of hosts, not all 45.
    if allow_network:
        todo = [v for v in venues if v["_reason"]]
        skipped = len(venues) - len(todo)
        print(f"Probing {len(todo)} venue(s), reusing {skipped} cached result(s)")
        for v in todo:
            print(f"  ~ {v['name']}: {v['_reason']}")

        stamp = now.replace(microsecond=0).isoformat()
        if todo:
            with concurrent.futures.ThreadPoolExecutor(MAX_PROBE_WORKERS) as pool:
                for venue, status in zip(todo, pool.map(probe, (v["url"] for v in todo))):
                    venue["link_status"] = status
                    venue["link_checked_on"] = stamp
        for v in venues:
            if not v["_reason"]:
                v["link_status"] = v["_cached"].get("link_status", "unknown")
                v["link_checked_on"] = v["_cached"].get("link_checked_on", "")
        # A rollover is only trusted if the new URL still resolves once we get
        # here. Hosts have handed us a 200 during the rollover check and a 404
        # moments later (conferences.sigcomm.org has done both), so verify
        # rather than assume, and put the venue back if the new link is dead.
        for venue in venues:
            entry = rolled.get(venue["id"])
            if entry and venue["link_status"] != "ok":
                raw, before = entry
                restore(raw, before)
                print(f"  ! {venue['name']}: rollover to {venue['url']} landed on a "
                      f"{venue['link_status']} link - reverted to {before['url']}",
                      file=sys.stderr)
                rolled.pop(venue["id"])
                fixed = normalise(raw)
                fixed["link_status"] = "ok"        # the URL we came from
                fixed["link_checked_on"] = venue.get("link_checked_on", "")
                for d in fixed["deadlines"]:
                    d.pop("_dt", None)
                venues[venues.index(venue)] = fixed

        dead = [v["name"] for v in venues if v["link_status"] == "dead"]
        if dead:
            print(f"  ! dead links: {', '.join(dead)}", file=sys.stderr)
    else:
        for venue in venues:
            venue["link_status"] = venue["_cached"].get("link_status", "unknown")
            venue["link_checked_on"] = venue["_cached"].get("link_checked_on", "")

    for venue in venues:
        venue.pop("_reason", None)
        venue.pop("_cached", None)

    payload = {
        "generated_at": now.replace(microsecond=0).isoformat(),
        "aoe_label": aoe_label,
        "counts": {
            "total": len(venues),
            **{tier: sum(v["tier"] == tier for v in venues) for tier in sorted(VALID_TIERS)},
        },
        "venues": venues,
    }

    if args.dry_run:
        print(json.dumps(payload["counts"], indent=2))
        print(f"(dry run) config_changed={config_changed}")
        return 0

    if stamp_assets():
        print("Re-stamped asset cache-busting hashes")

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
