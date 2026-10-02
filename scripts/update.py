#!/usr/bin/env python3
"""Refresh the conference data in the database.

Run nightly by .github/workflows/update-deadlines.yml, and on every push that
touches the data.

What it does
  1. Reads every venue from the database (scripts/db.py).
  2. Rolls a venue over to next year's site once its cycle is done and the new
     page is actually live (see roll_over_cycle).
  3. Probes the links that plausibly moved, so the dashboard can flag dead URLs.
  4. Writes the changes back and re-dumps data/whiterabbit.sql; the site is
     built from it (web/).

Usage
  python scripts/update.py                 # full run (network probes on)
  python scripts/update.py --no-network    # offline: no link probes
  python scripts/update.py --dry-run       # print what would change
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402

ROOT = db.ROOT

# Several conference hosts (systor.org among them) answer 403 to an obvious
# bot UA, which would show up as a false "not checked" on the dashboard.
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
TIMEOUT = 15
MAX_PROBE_WORKERS = 8
# A venue's stage on a project's path.
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

# --------------------------------------------------------------------------
# probe policy
#
# Link probing is the only slow part of a build, and most links do not change.
# So a nightly run only re-checks what plausibly moved, and everything else
# keeps the result stored in the database. Countdowns are unaffected either way -
# they are computed in the browser from the ISO dates, not stored here.
# --------------------------------------------------------------------------
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


def probe_with_code(url: str) -> tuple[str, int | None]:
    """Return ('ok' | 'dead' | 'unknown', last HTTP status) for a URL."""
    if not url:
        return "unknown", None
    code = None
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(url, method=method, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return ("ok" if 200 <= resp.status < 400 else "dead"), resp.status
        except urllib.error.HTTPError as exc:
            code = exc.code
            if exc.code in (403, 405, 406, 429):
                continue  # bot-blocked or method not allowed -> retry as GET
            return ("dead" if exc.code in (404, 410) else "unknown"), code
        except Exception:
            continue
    return "unknown", code


def probe(url: str) -> str:
    return probe_with_code(url)[0]


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
# normalisation - every optional field gets a sane default here
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
        "topics": [str(t).strip() for t in (raw.get("topics") or []) if str(t).strip()],
        "publisher": str(raw.get("publisher") or "").strip(),
        "notes": str(raw.get("notes") or "").strip(),
        "deadlines": deadlines,
    }


# --------------------------------------------------------------------------
# year rollover
# --------------------------------------------------------------------------
def roll_over_cycle(conn, venue, now, grace_days, allow_network) -> tuple | None:
    """Move a venue on to next year's site once this cycle is over.

    Returns (old_year, old_url) if the database was changed, so the caller can
    undo it. Deliberately conservative: we only move when the next-year page
    answers 200, so a venue that has not published its site yet simply stays
    put and is retried tomorrow.

    The finished cycle's deadline rows stay as history. The next cycle gets new
    rows, shifted by the cycle length and unverified: a shifted date is an
    estimate until someone reads it on the new CFP page.
    """
    template, year = venue["url_template"], venue["year"]
    step = venue["cycle_years"]  # 2 for biennial venues such as HotOS
    if venue["rolling"] or not template or not isinstance(year, int):
        return None

    dated = [d["_dt"] for d in venue["deadlines"] if d["_dt"]]
    if not dated:
        return None
    if now < max(dated) + timedelta(days=grace_days):
        return None  # cycle still running

    next_year = year + step
    next_url = render_template(template, next_year)
    if not allow_network:
        print(f"  - {venue['name']}: cycle over, would probe {next_url}")
        return None
    if probe(next_url) != "ok" or not page_mentions_year(next_url, next_year):
        print(f"  - {venue['name']}: {next_year} site not live yet ({next_url})")
        return None

    conn.execute("UPDATE venues SET year = ?, url = ? WHERE id = ?", (next_year, next_url, venue["id"]))
    conn.execute("DELETE FROM deadlines WHERE venue_id = ? AND cycle_year = ?", (venue["id"], next_year))
    for i, d in enumerate(venue["deadlines"]):
        date = shift_year(d["_dt"], step).isoformat() if d["_dt"] else None
        conn.execute(
            "INSERT INTO deadlines (venue_id, cycle_year, position, name, track, date, status, source) "
            "VALUES (?, ?, ?, ?, ?, ?, 'unverified', ?)",
            (venue["id"], next_year, i, d["name"], d["track"], date, d["source"]))
    db.record_change(conn, "venue", venue["id"], "rolled_over", "", str(year), str(next_year), next_url)
    print(f"  * {venue['name']}: rolled over to {next_year} -> {next_url}")
    return (year, venue["url"])


def undo_rollover(conn, venue_id: str, before: tuple) -> None:
    old_year, old_url = before
    new_year = conn.execute("SELECT year FROM venues WHERE id = ?", (venue_id,)).fetchone()[0]
    conn.execute("DELETE FROM deadlines WHERE venue_id = ? AND cycle_year = ?", (venue_id, new_year))
    conn.execute("UPDATE venues SET year = ?, url = ? WHERE id = ?", (old_year, old_url, venue_id))
    # the rollover never really happened, so it leaves no trace in the feed
    conn.execute("DELETE FROM changes WHERE id = (SELECT max(id) FROM changes WHERE entity = 'venue' "
                 "AND entity_id = ? AND kind = 'rolled_over')", (venue_id,))


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
    stamp = now.replace(microsecond=0).isoformat()

    conn = db.connect()
    grace_days = int(db.get_meta(conn, "grace_days", "21"))
    records = db.venue_records(conn)
    print(f"Loaded {len(records)} venues from {db.DUMP.relative_to(ROOT)}")

    venues = []
    rolled: dict[str, tuple] = {}  # venue id -> (year, url) before rollover
    for record in records:
        venue = normalise(record)
        before = roll_over_cycle(conn, venue, now, grace_days, allow_network)
        if before:
            rolled[venue["id"]] = before
        # the last check's result is the probe cache
        cached = {"link_status": record["link_status"], "link_checked_on": record["link_checked_on"]}
        venue["_reason"] = (
            "scope=all" if args.scope == "all"
            else should_probe(venue, cached, now, args.max_age_days)
        )
        if before:
            venue["_reason"] = "rolled over"
            venue["url"] = conn.execute("SELECT url FROM venues WHERE id = ?", (venue["id"],)).fetchone()[0]
        venues.append(venue)

    # Probe only what needs it, concurrently. Everything else keeps its last
    # result, so a nightly run touches a handful of hosts, not all of them.
    if allow_network:
        todo = [v for v in venues if v["_reason"]]
        print(f"Probing {len(todo)} venue(s), reusing {len(venues) - len(todo)} cached result(s)")
        for v in todo:
            print(f"  ~ {v['name']}: {v['_reason']}")
        if todo:
            with concurrent.futures.ThreadPoolExecutor(MAX_PROBE_WORKERS) as pool:
                for venue, (status, code) in zip(todo, pool.map(probe_with_code, (v["url"] for v in todo))):
                    db.log_fetch(conn, venue["url"], code)
                    # A rollover is only trusted if the new URL still resolves
                    # here. Hosts have handed us a 200 during the rollover check
                    # and a 404 moments later (conferences.sigcomm.org has done
                    # both), so put the venue back if the new link is dead.
                    if venue["id"] in rolled and status != "ok":
                        undo_rollover(conn, venue["id"], rolled.pop(venue["id"]))
                        print(f"  ! {venue['name']}: rollover landed on a {status} link - reverted",
                              file=sys.stderr)
                        status = "ok"  # the URL we came from
                    conn.execute("UPDATE venues SET link_status = ?, link_checked_on = ? WHERE id = ?",
                                 (status, stamp, venue["id"]))
        dead = [r["name"] for r in conn.execute("SELECT name FROM venues WHERE link_status = 'dead'")]
        if dead:
            print(f"  ! dead links: {', '.join(dead)}", file=sys.stderr)

    if args.dry_run:
        tiers = {t: sum(v["tier"] == t for v in venues) for t in sorted(VALID_TIERS)}
        print(json.dumps({"total": len(venues), **tiers}, indent=2))
        print(f"(dry run) rolled over: {sorted(rolled) or 'none'}")
        conn.rollback()
        return 0

    conn.commit()
    db.dump(conn)
    if rolled:
        print(f"Rolled over: {', '.join(sorted(rolled))}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
