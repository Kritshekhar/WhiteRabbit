#!/usr/bin/env python3
"""Write data/deadlines.json and data/grants.json from the database.

The JSON files are what the current static pages fetch. They stay until the
new frontend reads the database at build time.

  python scripts/export_json.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402

DATA = db.ROOT / "data"


def write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {path.relative_to(db.ROOT)}")


def export(conn) -> None:
    stamp = db.now_iso()

    venues = db.venue_records(conn)
    write(DATA / "deadlines.json", {
        "generated_at": stamp,
        "aoe_label": db.get_meta(conn, "aoe_label", "AoE"),
        "counts": {
            "total": len(venues),
            **{tier: sum(v["tier"] == tier for v in venues) for tier in sorted(db.VALID_TIERS)},
        },
        "venues": venues,
    })

    grants = db.grant_records(conn)
    counts = {"total": len(grants)}
    for who in db.ELIGIBILITY:
        counts[who] = sum(g["eligibility"] == who for g in grants)
    write(DATA / "grants.json", {"generated_at": stamp, "counts": counts, "grants": grants})


def main() -> int:
    conn = db.connect()
    export(conn)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
