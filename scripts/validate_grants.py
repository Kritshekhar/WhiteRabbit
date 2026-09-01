#!/usr/bin/env python3
"""Validate grants.yml. Runs in CI alongside validate_config.py.

Same contract as the conference list: a date is either verified with a source
a reader can click, or it is estimated and says so.
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
CONFIG = ROOT / "grants.yml"

ELIGIBILITY = {"PhD student", "Postdoc", "Early-career faculty", "Faculty / PI"}
KNOWN_KEYS = {
    "name", "funder", "also_funded_by", "eligibility", "url", "amount",
    "opportunity_number", "topics", "notes", "deadlines", "solicitation", "source",
}
KNOWN_DEADLINE_KEYS = {"name", "date", "confirmed", "source", "verified_on"}

errors: list[str] = []
warnings: list[str] = []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()

    try:
        config = YAML().load(CONFIG.read_text(encoding="utf-8"))
    except YAMLError as exc:
        print(f"ERROR  {CONFIG.name} is not valid YAML:\n{exc}", file=sys.stderr)
        print("\nHint: a value containing ': ' must be quoted.", file=sys.stderr)
        return 1

    grants = (config or {}).get("grants") or []
    if not grants:
        print("ERROR  no `grants:` entries found", file=sys.stderr)
        return 1

    seen: dict[str, str] = {}
    for i, g in enumerate(grants):
        name = str(g.get("name") or "").strip()
        where = name or f"grants[{i}]"
        if not name:
            errors.append(f"ERROR  {where}: missing required field `name`")
            continue

        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        if slug in seen:
            errors.append(f"ERROR  {where}: duplicate of {seen[slug]!r}")
        seen[slug] = name

        for key in set(g) - KNOWN_KEYS:
            warnings.append(f"WARN   {where}: unknown field {key!r}")

        eligibility = str(g.get("eligibility") or "").strip()
        if eligibility and eligibility not in ELIGIBILITY:
            errors.append(f"ERROR  {where}: eligibility {eligibility!r} not one of {sorted(ELIGIBILITY)}")

        url = str(g.get("url") or "")
        if url and not url.startswith(("http://", "https://")):
            errors.append(f"ERROR  {where}: url {url!r} must start with http")

        for j, d in enumerate(g.get("deadlines") or []):
            spot = f"{where} deadlines[{j}]"
            if not isinstance(d, dict):
                errors.append(f"ERROR  {spot}: must be a mapping")
                continue
            for key in set(d) - KNOWN_DEADLINE_KEYS:
                warnings.append(f"WARN   {spot}: unknown field {key!r}")
            raw = d.get("date")
            if raw not in (None, "", "TBA"):
                text = str(raw).strip().replace("Z", "+00:00")
                try:
                    parsed = datetime.fromisoformat(text)
                except ValueError:
                    errors.append(f"ERROR  {spot}: date {raw!r} is not ISO 8601")
                    continue
                if parsed.tzinfo is None and "T" in text:
                    errors.append(f"ERROR  {spot}: date {raw!r} has a time but no timezone offset")
                # a deadline decades out is a placeholder, not a date
                if parsed.year > datetime.now().year + 6:
                    errors.append(f"ERROR  {spot}: date {raw!r} is implausibly far away "
                                  "(grants.gov uses placeholders like 2076 for rolling calls)")
            if d.get("confirmed") and not d.get("source"):
                errors.append(f"ERROR  {spot}: confirmed: true needs a `source:` URL")

    for line in warnings:
        print(line)
    for line in errors:
        print(line, file=sys.stderr)
    print(f"\n{len(grants)} grants checked - {len(errors)} error(s), {len(warnings)} warning(s)")
    if errors:
        return 1
    return 1 if (args.strict and warnings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
