#!/usr/bin/env python3
"""Validate conferences.yml. Runs in CI on every pull request.

Contributors edit one file, so this is the guard rail that catches the
mistakes that file actually attracts: an unquoted value containing ": ",
a date with no timezone offset, a tier typo, a url_template that does not
render, a venue added twice.

Exit code 1 on any ERROR. Warnings never fail the build.

  python scripts/validate_config.py
  python scripts/validate_config.py --strict   # warnings fail too
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.error import YAMLError

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "conferences.yml"

VALID_TIERS = {"rabbit-hole", "royal-flush", "full-house", "looking-glass"}
# Older names still parse so an in-flight branch does not break.
LEGACY_TIERS = {
    "tier1": "royal-flush", "companion": "full-house", "workshop": "rabbit-hole",
    "queens-court": "royal-flush", "tea-party": "full-house",
    "caucus-race": "rabbit-hole", "high-card": "rabbit-hole",
    "wild-card": "looking-glass",
}
PLACEHOLDER = re.compile(r"\{(year|yyyy|yy|yyn)\}")
KNOWN_VENUE_KEYS = {
    "name", "full_name", "tier", "url", "url_template", "year", "month",
    "formats", "tracks", "deadlines", "rolling", "cycle_years", "notes",
}
KNOWN_DEADLINE_KEYS = {"name", "date", "confirmed", "track", "source", "verified_on"}

errors: list[str] = []
warnings: list[str] = []


def err(where: str, msg: str) -> None:
    errors.append(f"ERROR  {where}: {msg}")


def warn(where: str, msg: str) -> None:
    warnings.append(f"WARN   {where}: {msg}")


def check_deadline(where: str, entry, venue: dict) -> None:
    if not isinstance(entry, dict):
        err(where, f"deadline must be a mapping, got {type(entry).__name__}")
        return
    for key in set(entry) - KNOWN_DEADLINE_KEYS:
        warn(where, f"unknown field {key!r} (typo? it will be ignored)")

    raw = entry.get("date")
    if raw not in (None, "", "TBA"):
        text = str(raw).strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            err(where, f"date {raw!r} is not ISO 8601 (want 2026-09-17T23:59:00-12:00)")
            return
        if parsed.tzinfo is None and "T" in text:
            err(where, f"date {raw!r} has a time but no timezone offset - add -12:00 for AoE")
        if parsed.year < 2000 or parsed.year > 2100:
            err(where, f"date {raw!r} has an implausible year")

    if entry.get("confirmed") and not entry.get("source"):
        err(where, "confirmed: true needs a `source:` URL - a claim nobody can check is not verified")
    if entry.get("confirmed") is None:
        warn(where, "no `confirmed:` flag - it will default to false (est. badge)")


def check_venue(index: int, venue, seen: dict) -> None:
    where = f"venues[{index}]"
    if not isinstance(venue, dict):
        err(where, f"venue must be a mapping, got {type(venue).__name__}")
        return

    name = str(venue.get("name") or "").strip()
    if not name:
        err(where, "missing required field `name`")
        return
    where = f"{name}"

    for key in set(venue) - KNOWN_VENUE_KEYS:
        warn(where, f"unknown field {key!r} (typo? it will be ignored)")

    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if slug in seen:
        err(where, f"duplicate venue - collides with {seen[slug]!r}")
    seen[slug] = name

    tier = str(venue.get("tier") or "full-house").lower()
    if tier in LEGACY_TIERS:
        warn(where, f"tier {tier!r} is the old name - use {LEGACY_TIERS[tier]!r}")
    elif tier not in VALID_TIERS:
        err(where, f"tier {tier!r} is not one of {sorted(VALID_TIERS)}")

    url = str(venue.get("url") or "")
    if url and not url.startswith(("http://", "https://")):
        err(where, f"url {url!r} must start with http:// or https://")

    template = str(venue.get("url_template") or "")
    if template:
        if not PLACEHOLDER.search(template):
            err(where, f"url_template {template!r} has no {{year}}/{{yy}} placeholder - it can never roll over")
        if not isinstance(venue.get("year"), int):
            err(where, "url_template is set but `year` is missing or not an integer")

    year = venue.get("year")
    if year is not None and not isinstance(year, int):
        err(where, f"year {year!r} must be an integer")

    month = venue.get("month")
    if month is not None and not (isinstance(month, int) and 1 <= month <= 12):
        err(where, f"month {month!r} must be an integer 1-12")

    cycle = venue.get("cycle_years")
    if cycle is not None and not (isinstance(cycle, int) and 1 <= cycle <= 5):
        err(where, f"cycle_years {cycle!r} must be an integer 1-5")

    for field in ("formats", "tracks"):
        value = venue.get(field)
        if value is not None and not isinstance(value, list):
            err(where, f"{field} must be a list, e.g. [Full paper, Short paper]")

    deadlines = venue.get("deadlines")
    if venue.get("rolling"):
        if deadlines:
            warn(where, "rolling: true but deadlines are listed - they will not count down")
        return
    if not deadlines:
        warn(where, "no deadlines - the card will render as TBA")
        return
    if not isinstance(deadlines, list):
        err(where, "deadlines must be a list")
        return
    for i, entry in enumerate(deadlines):
        check_deadline(f"{name} deadlines[{i}]", entry, venue)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="treat warnings as errors")
    args = ap.parse_args()

    try:
        config = YAML().load(CONFIG.read_text(encoding="utf-8"))
    except YAMLError as exc:
        # by far the most common contributor mistake: an unquoted value
        # containing ": ", e.g.  notes: Prefix the title: like this
        print(f"ERROR  {CONFIG.name} is not valid YAML:\n{exc}", file=sys.stderr)
        print("\nHint: a value containing ': ' must be quoted.", file=sys.stderr)
        return 1

    if not isinstance(config, dict) or "venues" not in config:
        print("ERROR  top-level `venues:` key is missing", file=sys.stderr)
        return 1

    venues = config["venues"] or []
    seen: dict[str, str] = {}
    for i, venue in enumerate(venues):
        check_venue(i, venue, seen)

    for line in warnings:
        print(line)
    for line in errors:
        print(line, file=sys.stderr)

    print(f"\n{len(venues)} venues checked - {len(errors)} error(s), {len(warnings)} warning(s)")
    if errors:
        return 1
    return 1 if (args.strict and warnings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
