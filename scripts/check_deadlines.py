#!/usr/bin/env python3
"""Pull deadline-looking lines off every venue's site, for eyeball verification.

This does NOT edit conferences.yml. Conference CFP pages are unstructured prose
and every venue words things differently, so auto-parsing them into the config
would quietly write wrong dates - the exact failure this tool exists to catch.
Instead it prints what each site says, next to what the config claims, and you
correct the config by hand and flip `confirmed: true`.

Usage
  python scripts/check_deadlines.py                # every venue
  python scripts/check_deadlines.py eurosys sosp   # just these (substring match)
  python scripts/check_deadlines.py --unconfirmed  # only venues still marked est.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import html
import re
import sys
import urllib.request
from pathlib import Path

from ruamel.yaml import YAML

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "conferences.yml"

UA = "conference-deadline-dashboard/1.0 (+https://github.com/)"
TIMEOUT = 25
WORKERS = 8

# Sub-pages worth trying when the landing page carries no dates.
SUBPAGES = [
    "cfp", "cfp.html", "call-for-papers", "callforpapers",
    "dates", "dates.html", "important-dates", "submission", "papers",
]
KEYWORDS = re.compile(
    r"(?i)\b(deadline|submission|abstract|paper.{0,12}due|due|registration|"
    r"notification|camera.?ready|cycle|round)\b"
)
DATEISH = re.compile(
    r"(?i)\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}"
    r"|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)"
    r"|\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b"
)


RESEARCHR = re.compile(r"https?://conf\.researchr\.org/[a-z]+/([a-zA-Z0-9._-]+)")
# The tracks that carry the deadline people actually mean. A researchr instance
# hosts dozens of co-located workshops whose rows would otherwise drown it out.
MAIN_TRACK = re.compile(r"(?i)^(research track|research papers|technical papers|technical track|main track)$")
ROW_KEYWORDS = re.compile(r"(?i)\b(submission|deadline|abstract|papers? due)\b")


def researchr_dates(url: str) -> tuple[list[str], str]:
    """conf.researchr.org renders its schedule client-side, so the landing page
    looks empty to a plain fetch. /dates/<slug> is the same data as a plain
    server-rendered table - When | Track | What."""
    match = RESEARCHR.match(url)
    if not match:
        return [], ""
    source = f"https://conf.researchr.org/dates/{match.group(1)}"
    markup = fetch(source)
    if not markup:
        return [], source

    main, other = [], []
    for row in re.findall(r"(?is)<tr\b.*?</tr>", markup):
        cells = [
            html.unescape(re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", cell))).strip()
            for cell in re.findall(r"(?is)<t[dh]\b.*?</t[dh]>", row)
        ]
        cells = [c for c in cells if c]
        if len(cells) < 3:
            continue
        when, track, what = cells[0], cells[1], cells[2]
        line = f"{when} | {track} | {what}"
        if MAIN_TRACK.match(track):
            main.append(line)
        elif ROW_KEYWORDS.search(what):
            other.append(line)
    # Main-track rows first; a handful of others for context.
    return main + other[:6], source


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read(600_000)
            charset = resp.headers.get_content_charset() or "utf-8"
        return raw.decode(charset, "ignore")
    except Exception:
        return ""


def to_text(markup: str) -> str:
    markup = re.sub(r"(?is)<(script|style|nav|footer).*?</\1>", " ", markup)
    markup = re.sub(r"(?i)<(br|/tr|/li|/p|/h[1-6]|/td)[^>]*>", "\n", markup)
    text = html.unescape(re.sub(r"(?s)<[^>]+>", " ", markup))
    return re.sub(r"[ \t\xa0]+", " ", text)


def hits(text: str) -> list[str]:
    found, seen = [], set()
    for line in text.splitlines():
        line = line.strip(" •-|\t")
        if not (8 < len(line) < 180):
            continue
        if not (KEYWORDS.search(line) and DATEISH.search(line)):
            continue
        key = re.sub(r"\s+", " ", line.lower())
        if key in seen:
            continue
        seen.add(key)
        found.append(re.sub(r"\s+", " ", line))
    return found


def inspect(venue: dict) -> tuple[dict, list[str], str]:
    url = (venue.get("url") or "").rstrip("/")
    if not url:
        return venue, [], ""
    found, source = researchr_dates(url)
    if found:
        return venue, found, source
    found = hits(to_text(fetch(url)))
    if found:
        return venue, found, url
    for suffix in SUBPAGES:  # landing page was a splash - try the usual CFP paths
        candidate = f"{url}/{suffix}"
        found = hits(to_text(fetch(candidate)))
        if found:
            return venue, found, candidate
    return venue, [], url


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*", help="substring filter on venue name")
    ap.add_argument("--unconfirmed", action="store_true", help="only venues with unconfirmed dates")
    ap.add_argument("--limit", type=int, default=14, help="max lines printed per venue")
    args = ap.parse_args()

    config = YAML().load(CONFIG.read_text(encoding="utf-8"))
    venues = [v for v in config["venues"] if not v.get("rolling")]

    if args.names:
        wanted = [n.lower() for n in args.names]
        venues = [v for v in venues if any(w in str(v["name"]).lower() for w in wanted)]
    if args.unconfirmed:
        venues = [v for v in venues
                  if any(not d.get("confirmed") for d in (v.get("deadlines") or []))]

    print(f"Checking {len(venues)} venues\n", file=sys.stderr)
    with concurrent.futures.ThreadPoolExecutor(WORKERS) as pool:
        for venue, found, source in pool.map(inspect, venues):
            print(f"### {venue['name']}  ({venue.get('year', '?')})")
            print(f"    source: {source or 'no url'}")
            for d in venue.get("deadlines") or []:
                mark = "" if d.get("confirmed") else "  <- unconfirmed"
                print(f"    config: {d.get('name')}: {d.get('date')}{mark}")
            if not found:
                print("    site:   (nothing date-like found - check by hand)")
            for line in found[: args.limit]:
                print(f"    site:   {line}")
            print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
