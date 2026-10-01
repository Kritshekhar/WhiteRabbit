#!/usr/bin/env python3
"""Read deadline text off pages that need JavaScript, using headless Chrome.

Most fellowship pages are client-rendered, so a plain fetch sees an empty shell:
scraping all 13 of ours returned one usable line. Chrome is already installed on
any machine a person browses from, and --dump-dom returns the DOM *after* scripts
run, which is the same capability a rendering API sells. No key, no quota.

Like check_deadlines.py, this only prints. It never writes to a config, because a
page rendering correctly does not make its dates current.

  python scripts/render_check.py                      # every undated fellowship
  python scripts/render_check.py "Google PhD" NDSEG   # by name substring
"""

from __future__ import annotations

import argparse
import concurrent.futures
import html
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome", "chromium", "chromium-browser",
]
# Where a programme usually hides its dates when the landing page does not say.
SUBPATHS = ["", "apply", "applicants", "application", "how-to-apply",
            "eligibility", "faq", "dates", "important-dates", "overview"]

DEADLINE_WORDS = re.compile(
    r"(?i)\b(deadline|due|closes?|opens?|applications?|nominations?|submissions?)\b")
DATE_SHAPE = re.compile(
    r"(?i)\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}"
    r"|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)"
    r"|\b\d{1,2}/\d{1,2}/\d{2,4}\b|\b20\d\d-\d\d-\d\d\b")


def find_chrome() -> str | None:
    for candidate in CHROME_CANDIDATES:
        if Path(candidate).exists():
            return candidate
        found = shutil.which(candidate)
        if found:
            return found
    return None


def render(chrome: str, url: str, timeout: int = 45) -> str:
    """Return the DOM after scripts have run, or '' if the page will not load."""
    try:
        out = subprocess.run(
            [chrome, "--headless=old", "--disable-gpu", "--no-sandbox",
             "--virtual-time-budget=12000", "--dump-dom", url],
            capture_output=True, timeout=timeout, text=True, errors="ignore")
        return out.stdout or ""
    except (subprocess.TimeoutExpired, OSError):
        return ""


def visible_text(markup: str) -> list[str]:
    markup = re.sub(r"(?is)<(script|style|svg|nav|footer|head)\b.*?</\1>", " ", markup)
    text = html.unescape(re.sub(r"(?s)<[^>]+>", "\n", markup))
    return [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]


def deadline_lines(lines: list[str]) -> list[str]:
    found, seen = [], set()
    for line in lines:
        if not (10 < len(line) < 200):
            continue
        if not (DEADLINE_WORDS.search(line) and DATE_SHAPE.search(line)):
            continue
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        found.append(line)
    return found


def inspect(chrome: str, entry: dict) -> tuple[dict, str, list[str]]:
    base = (entry.get("url") or "").rstrip("/")
    if not base:
        return entry, "", []
    root = f"{urlsplit(base).scheme}://{urlsplit(base).netloc}"
    tried = []
    for suffix in SUBPATHS:
        for stem in (base, root) if suffix else (base,):
            url = stem if not suffix else f"{stem}/{suffix}"
            if url in tried:
                continue
            tried.append(url)
            hits = deadline_lines(visible_text(render(chrome, url)))
            if hits:
                return entry, url, hits
    return entry, base, []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*", help="substring filter on the programme name")
    ap.add_argument("--limit", type=int, default=8, help="lines printed per programme")
    args = ap.parse_args()

    chrome = find_chrome()
    if not chrome:
        print("No Chrome or Chromium found. Install one, or use "
              "check_deadlines.py --firecrawl with an API key.", file=sys.stderr)
        return 1

    rows = [g for g in db.grant_records(db.connect()) if not any(d["date"] for d in g["deadlines"])]
    if args.names:
        wanted = [n.lower() for n in args.names]
        rows = [g for g in rows if any(w in g["name"].lower() for w in wanted)]

    print(f"Rendering {len(rows)} programmes with {Path(chrome).name}\n", file=sys.stderr)
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        for entry, source, hits in pool.map(lambda g: inspect(chrome, g), rows):
            print(f"### {entry['name']}")
            print(f"    config: no date recorded")
            print(f"    source: {source}")
            for line in hits[: args.limit]:
                print(f"    site:   {line}")
            if not hits:
                print("    site:   (nothing date-like, even rendered)")
            print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
