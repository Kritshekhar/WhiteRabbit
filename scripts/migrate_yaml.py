#!/usr/bin/env python3
"""One-time move from conferences.yml + grants.yml into the database.

Reuses the build scripts' own normalise() functions, so the database holds
exactly what the site was already showing: same defaults, same date
normalisation, same duplicate handling. Link-check results come from the last
build (data/*.json), since the YAML never stored them.

  python scripts/migrate_yaml.py      # writes db/whiterabbit.sql
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from ruamel.yaml import YAML

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402
import update  # noqa: E402
import update_grants  # noqa: E402

ROOT = db.ROOT


def previous(path: Path, key: str) -> dict:
    if not path.exists():
        return {}
    return {r["id"]: r for r in json.loads(path.read_text(encoding="utf-8"))[key]}


def migrate_venues(conn, config: dict) -> int:
    settings = config.get("settings") or {}
    db.set_meta(conn, "grace_days", int(settings.get("grace_days", 21)))
    db.set_meta(conn, "aoe_label", str(settings.get("aoe_label", "AoE")))
    links = previous(ROOT / "data" / "deadlines.json", "venues")

    seen = set()
    for raw in config.get("venues") or []:
        v = update.normalise(raw)
        if v["id"] in seen:
            print(f"  ! duplicate venue {v['name']!r}, skipping", file=sys.stderr)
            continue
        seen.add(v["id"])
        link = links.get(v["id"], {})
        conn.execute(
            "INSERT INTO venues (id, position, name, full_name, tier, url, url_template, year, month, "
            "rolling, cycle_years, formats, tracks, topics, publisher, notes, link_status, link_checked_on) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (v["id"], len(seen), v["name"], v["full_name"], v["tier"], v["url"], v["url_template"],
             v["year"], v["month"], int(v["rolling"]), v["cycle_years"], db.jdump(v["formats"]),
             db.jdump(v["tracks"]), db.jdump(v["topics"]), v["publisher"], v["notes"],
             link.get("link_status", "unknown"), link.get("link_checked_on", "")))
        for i, d in enumerate(v["deadlines"]):
            conn.execute(
                "INSERT INTO deadlines (venue_id, cycle_year, position, name, track, date, status, "
                "source, verified_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (v["id"], v["year"], i, d["name"], d["track"], d["date"],
                 "verified" if d["confirmed"] else "unverified", d["source"], d["verified_on"]))
    return len(seen)


def migrate_grants(conn, config: dict) -> int:
    settings = config.get("settings") or {}
    db.set_meta(conn, "grants_grace_days", int(settings.get("grace_days", 14)))
    links = previous(ROOT / "data" / "grants.json", "grants")

    seen = set()
    for raw in config.get("grants") or []:
        g = update_grants.normalise(raw)
        if g["id"] in seen:
            print(f"  ! duplicate grant {g['name']!r}, skipping", file=sys.stderr)
            continue
        seen.add(g["id"])
        conn.execute(
            "INSERT INTO grants (id, position, name, funder, also_funded_by, eligibility, url, amount, "
            "opportunity_number, topics, notes, ccs, ccs_auto, funding, typical_window, last_checked, "
            "solicitation, source, link_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (g["id"], len(seen), g["name"], g["funder"], db.jdump(g["also_funded_by"]), g["eligibility"],
             g["url"], g["amount"], g["opportunity_number"], db.jdump(g["topics"]), g["notes"], g["ccs"],
             int(g["ccs_auto"]), db.jdump(g["funding"]), g["typical_window"], g["last_checked"],
             str(raw.get("solicitation") or "").strip(), str(raw.get("source") or "").strip(),
             links.get(g["id"], {}).get("link_status", "unknown")))

        # normalise() drops verified_on, so rebuild the list with it, in the
        # same order normalise() sorts into
        rows = []
        for entry in raw.get("deadlines") or []:
            dt = update_grants.parse_date(entry.get("date"))
            rows.append({
                "name": str(entry.get("name") or "Application"),
                "date": dt.isoformat() if dt else None,
                "status": "verified" if entry.get("confirmed") else "unverified",
                "source": str(entry.get("source") or "").strip(),
                "verified_on": str(entry.get("verified_on") or "").strip(),
            })
        rows.sort(key=lambda d: (d["date"] is None, d["date"] or ""))
        for i, d in enumerate(rows):
            conn.execute(
                "INSERT INTO grant_deadlines (grant_id, position, name, date, status, source, verified_on) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (g["id"], i, d["name"], d["date"], d["status"], d["source"], d["verified_on"]))
    return len(seen)


def migrate_solicitations(conn) -> int:
    path = ROOT / "data" / "solicitations.json"
    if not path.exists():
        return 0
    records = json.loads(path.read_text(encoding="utf-8"))
    seen = set()
    for i, s in enumerate(records):
        # The corpus is per grant entry, so one opportunity listed under two
        # names appears twice. Keep the first.
        if str(s["id"]) in seen:
            print(f"  ! solicitation {s['id']} ({s.get('name')!r}) listed twice, keeping the first",
                  file=sys.stderr)
            continue
        seen.add(str(s["id"]))
        conn.execute(
            "INSERT INTO solicitations (id, position, name, agency, opportunity_number, close, solicitation, "
            "award_ceiling, award_floor, total_program_funding, expected_awards, description) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (str(s["id"]), i, s.get("name") or "", s.get("agency") or "", s.get("opportunity_number") or "",
             s.get("close"), s.get("solicitation") or "", s.get("award_ceiling"), s.get("award_floor"),
             s.get("total_program_funding"), s.get("expected_awards"), s.get("description") or ""))
    return len(seen)


def main() -> int:
    if db.DUMP.exists():
        print(f"{db.DUMP.relative_to(ROOT)} already exists - delete it to migrate again", file=sys.stderr)
        return 1
    yaml = YAML(typ="safe")
    venues_cfg = yaml.load((ROOT / "conferences.yml").read_text(encoding="utf-8"))
    grants_cfg = yaml.load((ROOT / "grants.yml").read_text(encoding="utf-8"))

    db.DB_FILE.unlink(missing_ok=True)
    with db.session() as conn:
        n_venues = migrate_venues(conn, venues_cfg)
        n_grants = migrate_grants(conn, grants_cfg)
        n_sol = migrate_solicitations(conn)
    print(f"Migrated {n_venues} venues, {n_grants} grants, {n_sol} solicitations "
          f"-> {db.DUMP.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
