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
import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from ruamel.yaml import YAML

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "conferences.yml"

# Several conference hosts (systor.org among them) answer 403 to an obvious
# bot UA, which would show up as a false "not checked" on the dashboard.
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
TIMEOUT = 25
WORKERS = 8

# Sub-pages worth trying when the landing page carries no dates.
SUBPAGES = [
    "cfp", "cfp.html", "call-for-papers", "callforpapers", "call-for-papers.html",
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
# The track name is sometimes prefixed with the venue ("PLDI Research Papers").
MAIN_TRACK = re.compile(
    r"(?i)^(\S+\s+)?(research track|research papers|technical papers|technical track|main track|papers)$"
)
ROW_KEYWORDS = re.compile(r"(?i)\b(submission|deadline|abstract|papers? due)\b")


def researchr_dates(url: str) -> tuple[list[str], str]:
    """conf.researchr.org renders its schedule client-side, so the landing page
    looks empty to a plain fetch. /dates/<slug> is the same data as a plain
    server-rendered table - When | Track | What."""
    match = RESEARCHR.match(url)
    if match:
        source = f"https://conf.researchr.org/dates/{match.group(1)}"
    else:
        # researchr also powers per-conference hosts (pldi27.sigplan.org,
        # 2027.msrconf.org, ...), where the same table lives at <host>/dates.
        parts = urlsplit(url)
        if not parts.netloc:
            return [], ""
        source = f"{parts.scheme}://{parts.netloc}/dates"
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
    if not (main or other):
        return [], ""  # not a researchr site after all
    # Main-track rows first; a handful of others for context.
    return main + other[:6], source


# ---------------------------------------------------------------------------
# Firecrawl (optional)
#
# Used ONLY here, in the human-in-the-loop checker - never in update.py. This
# tool proposes; a person decides. An extractor that wrote straight into the
# config would eventually write a wrong date with total confidence, which is
# the one failure this project cannot afford: NDSS's 2027 page still serves
# 2024 dates, and SIGCOMM's 2027 site still serves the 2026 call.
#
# Works without a key at a low rate limit; FIRECRAWL_API_KEY raises the limit
# and unlocks /map, which finds a venue's CFP page instead of guessing paths.
# ---------------------------------------------------------------------------
FIRECRAWL_API = "https://api.firecrawl.dev/v2"
FIRECRAWL_KEY = os.environ.get("FIRECRAWL_API_KEY", "").strip()


def firecrawl(endpoint: str, payload: dict, timeout: int = 90) -> dict:
    body = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json", "User-Agent": UA}
    if FIRECRAWL_KEY:
        headers["Authorization"] = f"Bearer {FIRECRAWL_KEY}"
    req = urllib.request.Request(f"{FIRECRAWL_API}/{endpoint}", data=body,
                                 headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8", "ignore"))
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def firecrawl_markdown(url: str) -> str:
    """Render a page (JS included) and return clean markdown."""
    result = firecrawl("scrape", {"url": url, "formats": ["markdown"],
                                  "onlyMainContent": True})
    if not result.get("success"):
        return ""
    return (result.get("data") or {}).get("markdown", "")


def firecrawl_find_cfp(url: str) -> list[str]:
    """Ask for the venue's own CFP-ish URLs. Requires an API key."""
    if not FIRECRAWL_KEY:
        return []
    result = firecrawl("map", {"url": url, "search": "call for papers important dates"})
    if not result.get("success"):
        return []
    out = []
    for link in result.get("links") or []:
        target = link.get("url") if isinstance(link, dict) else link
        if target and re.search(r"(?i)(cfp|call|dates|submission|paper)", target):
            out.append(target)
    return out[:4]


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


# What a venue accepts is stated in prose too ("no longer than five (5) pages",
# "Research Track", "Position or Regular"), so --formats greps for that shape.
FORMAT_PATTERNS = re.compile(
    r"(?i)\b("
    r"full paper|short paper|position paper|regular paper|research paper|"
    r"industry paper|experience paper|tool paper|demo(?:nstration)? paper|"
    r"work[- ]in[- ]progress|poster|talk proposal|tutorial proposal|"
    r"systematization of knowledge|SoK|extended abstract|"
    r"\d{1,2}\s*(?:\(\w+\)\s*)?pages?|(?:two|three|four|five|six|eight|ten|twelve)\s*\(?\d*\)?\s*pages?"
    r")\b"
)
TRACK_PATTERNS = re.compile(
    r"(?i)\b((?:research|industry|industrial|applied|experience|poster|demo|"
    r"tool|artifact|short paper|main|technical)\s+track)\b"
)


def format_hits(text: str) -> list[str]:
    """Lines that say what a venue accepts, or what its tracks are."""
    found, seen = [], set()
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line.strip(" •-|\t"))
        if not (12 < len(line) < 240):
            continue
        if not (FORMAT_PATTERNS.search(line) or TRACK_PATTERNS.search(line)):
            continue
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        found.append(line)
    return found


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


def inspect_formats(venue: dict, use_firecrawl: bool = False) -> tuple[dict, list[str], str]:
    """Same page hunt as inspect(), but looking for accepted formats/tracks."""
    url = (venue.get("url") or "").rstrip("/")
    if not url:
        return venue, [], ""
    # Try the CFP pages FIRST here. A landing page often mentions "Posters
    # Co-Chairs" or similar, which matches but tells you nothing about what the
    # venue accepts; the call itself is where the page limits live.
    for candidate in [f"{url}/{suffix}" for suffix in SUBPAGES] + [url]:
        found = format_hits(to_text(fetch(candidate)))
        if len(found) >= 2:  # one stray match is usually noise
            return venue, found, candidate
    if use_firecrawl:
        found = format_hits(firecrawl_markdown(url))
        if found:
            return venue, found, f"{url}  (via Firecrawl)"
    return venue, [], url


def inspect(venue: dict, use_firecrawl: bool = False) -> tuple[dict, list[str], str]:
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

    if not use_firecrawl:
        return venue, [], url

    # Everything free has failed: the page is JS-rendered, bot-blocked, or the
    # dates are in prose the regex above cannot see.
    found = hits(firecrawl_markdown(url))
    if found:
        return venue, found, f"{url}  (via Firecrawl)"
    for candidate in firecrawl_find_cfp(url):  # key only
        found = hits(firecrawl_markdown(candidate))
        if found:
            return venue, found, f"{candidate}  (via Firecrawl /map)"
    return venue, [], url


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*", help="substring filter on venue name")
    ap.add_argument("--unconfirmed", action="store_true", help="only venues with unconfirmed dates")
    ap.add_argument("--limit", type=int, default=14, help="max lines printed per venue")
    ap.add_argument("--formats", action="store_true",
                    help="look for accepted paper formats and track names instead of dates")
    ap.add_argument("--firecrawl", action="store_true",
                    help="fall back to Firecrawl for pages plain fetching cannot read "
                         "(works keyless; FIRECRAWL_API_KEY raises limits and enables /map)")
    args = ap.parse_args()

    config = YAML().load(CONFIG.read_text(encoding="utf-8"))
    venues = [v for v in config["venues"] if not v.get("rolling")]

    if args.names:
        wanted = [n.lower() for n in args.names]
        venues = [v for v in venues if any(w in str(v["name"]).lower() for w in wanted)]
    if args.unconfirmed:
        venues = [v for v in venues
                  if any(not d.get("confirmed") for d in (v.get("deadlines") or []))]

    if args.firecrawl:
        mode = "with API key" if FIRECRAWL_KEY else "keyless (lower rate limit, no /map)"
        print(f"Firecrawl fallback enabled - {mode}", file=sys.stderr)
    print(f"Checking {len(venues)} venues\n", file=sys.stderr)
    workers = 3 if args.firecrawl else WORKERS  # be polite to the API
    probe = inspect_formats if args.formats else inspect
    with concurrent.futures.ThreadPoolExecutor(workers) as pool:
        for venue, found, source in pool.map(
            lambda v: probe(v, args.firecrawl), venues
        ):
            print(f"### {venue['name']}  ({venue.get('year', '?')})")
            print(f"    source: {source or 'no url'}")
            if args.formats:
                print(f"    config: formats={venue.get('formats') or []} "
                      f"tracks={venue.get('tracks') or []}")
            else:
                for d in venue.get("deadlines") or []:
                    mark = "" if d.get("confirmed") else "  <- unconfirmed"
                    print(f"    config: {d.get('name')}: {d.get('date')}{mark}")
            if not found:
                what = "format-like" if args.formats else "date-like"
                print(f"    site:   (nothing {what} found - check by hand)")
            for line in found[: args.limit]:
                print(f"    site:   {line}")
            print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
