#!/usr/bin/env python3
"""Edit the WhiteRabbit database by hand - what editing the YAML used to be.

Every command writes through scripts/db.py, so the committed dump
(db/whiterabbit.sql) is updated and the change shows up in `git diff`.

  python scripts/wr.py show fast                     # a venue or grant, by id
  python scripts/wr.py queue                         # what still needs verifying
  python scripts/wr.py add-venue "HotStorage" --tier rabbit-hole \\
      --url https://www.hotstorage.org/2027/ --year 2027 --topic Storage
  python scripts/wr.py add-deadline fast "Abstract" 2026-09-08T23:59:00-12:00
  python scripts/wr.py verify fast --source https://www.usenix.org/conference/fast27
  python scripts/wr.py verify fast --deadline Abstract --date 2026-09-09T23:59:00-12:00 \\
      --source https://www.usenix.org/conference/fast27/call-for-papers
  python scripts/wr.py set fast notes "Shepherding for all accepted papers."

`verify` is the only way a row becomes verified, and it needs a --source: the
first-party page where you read the date. Verified rows are never crawled again.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402
import update  # noqa: E402

LIST_FIELDS = {"formats", "tracks", "topics", "also_funded_by"}
INT_FIELDS = {"year", "month", "cycle_years", "rolling", "ccs_auto"}


def parse_date(text: str):
    """A date for a deadline. A bare date means AoE end of day; a time without
    an offset is refused, because that ambiguity shifts a deadline by a day."""
    dt = update.parse_date(text)
    if dt is None:
        sys.exit(f"not saved: {text!r} is not an ISO 8601 date")
    if "T" in text and datetime.fromisoformat(text.replace("Z", "+00:00")).tzinfo is None:
        sys.exit(f"not saved: {text!r} has a time but no offset - add -12:00 for AoE")
    return dt


def find(conn, ident: str) -> tuple[str, dict]:
    """Resolve an id (or a name) to ('venue' | 'grant', row)."""
    for table, kind in (("venues", "venue"), ("grants", "grant")):
        row = conn.execute(f"SELECT * FROM {table} WHERE id = ? OR lower(name) = lower(?)",
                           (db.slugify(ident), ident)).fetchone()
        if row:
            return kind, dict(row)
    sys.exit(f"no venue or grant called {ident!r}")


def current_deadlines(conn, kind: str, row: dict) -> list:
    if kind == "venue":
        return conn.execute("SELECT * FROM deadlines WHERE venue_id = ? AND cycle_year IS ? ORDER BY position",
                            (row["id"], row["year"])).fetchall()
    return conn.execute("SELECT * FROM grant_deadlines WHERE grant_id = ? ORDER BY position",
                        (row["id"],)).fetchall()


def cmd_show(conn, args) -> None:
    kind, row = find(conn, args.id)
    print(f"[{kind}]")
    for key, value in row.items():
        if value not in ("", "[]", "{}", None):
            print(f"  {key:<18} {value}")
    for d in current_deadlines(conn, kind, row):
        mark = "verified" if d["status"] == "verified" else "est."
        print(f"  deadline           {d['name']}: {d['date'] or 'TBA'}  [{mark}] {d['source']}")


def cmd_queue(conn, args) -> None:
    rows = conn.execute("SELECT entity, owner, count(*) AS n FROM needs_check "
                        "GROUP BY entity, owner ORDER BY entity, owner").fetchall()
    for r in rows:
        print(f"  {r['entity']:<15} {r['owner']}  ({r['n']})")
    print(f"\n{sum(r['n'] for r in rows)} unverified row(s)")
    cands = conn.execute("SELECT * FROM candidates ORDER BY last_checked DESC").fetchall()
    if cands:
        print("\nProposed by crawlers, awaiting a person:")
        for c in cands:
            print(f"  {c['entity']} {c['entity_id']} {c['field']} = {c['proposed_value']}  "
                  f"(seen {c['attempts']}x, {c['source']})")


def cmd_add_venue(conn, args) -> None:
    raw = {"name": args.name, "full_name": args.full_name, "tier": args.tier, "url": args.url,
           "url_template": args.url_template, "year": args.year, "month": args.month,
           "topics": args.topic, "publisher": args.publisher, "notes": args.notes}
    venue = update.normalise(raw)
    db.insert_venue(conn, venue)
    print(f"added venue {venue['id']}")


def cmd_add_deadline(conn, args) -> None:
    kind, row = find(conn, args.id)
    dt = parse_date(args.date) if args.date else None
    position = len(current_deadlines(conn, kind, row))
    if kind == "venue":
        conn.execute("INSERT INTO deadlines (venue_id, cycle_year, position, name, track, date) "
                     "VALUES (?, ?, ?, ?, ?, ?)",
                     (row["id"], row["year"], position, args.name, args.track, dt.isoformat() if dt else None))
    else:
        conn.execute("INSERT INTO grant_deadlines (grant_id, position, name, date) VALUES (?, ?, ?, ?)",
                     (row["id"], position, args.name, dt.isoformat() if dt else None))
    print(f"added unverified deadline {args.name!r} to {row['id']}")


def cmd_verify(conn, args) -> None:
    kind, row = find(conn, args.id)
    deadlines = current_deadlines(conn, kind, row)
    if args.deadline:
        deadlines = [d for d in deadlines if d["name"].lower() == args.deadline.lower()]
    if not deadlines:
        sys.exit("no matching deadline")
    if args.date and len(deadlines) != 1:
        sys.exit("--date needs exactly one deadline; pick it with --deadline")
    table = "deadlines" if kind == "venue" else "grant_deadlines"
    for d in deadlines:
        dt = parse_date(args.date) if args.date else None
        conn.execute(f"UPDATE {table} SET status = 'verified', source = ?, verified_on = ?, "
                     f"date = coalesce(?, date) WHERE id = ?",
                     (args.source, date.today().isoformat(), dt.isoformat() if dt else None, d["id"]))
        print(f"verified {row['id']}: {d['name']}")
    # whatever crawlers proposed for these rows is now settled
    entity = "deadline" if kind == "venue" else "grant_deadline"
    conn.executemany("DELETE FROM candidates WHERE entity = ? AND entity_id = ?",
                     [(entity, str(d["id"])) for d in deadlines])


def cmd_set(conn, args) -> None:
    kind, row = find(conn, args.id)
    if args.field not in row or args.field in ("id", "position"):
        sys.exit(f"{kind} has no settable field {args.field!r}")
    value = args.value
    if args.field in LIST_FIELDS:
        value = db.jdump([v.strip() for v in value.split(",") if v.strip()])
    elif args.field in INT_FIELDS:
        value = int(value) if value else None
    elif args.field == "funding":
        value = db.jdump(json.loads(value))
    conn.execute(f"UPDATE {kind}s SET {args.field} = ? WHERE id = ?", (value, row["id"]))
    print(f"{row['id']}.{args.field} = {value}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Edit the WhiteRabbit database.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("show"); p.add_argument("id")
    sub.add_parser("queue")

    p = sub.add_parser("add-venue")
    p.add_argument("name")
    p.add_argument("--full-name", default="")
    p.add_argument("--tier", default="full-house", choices=db.VALID_TIERS)
    p.add_argument("--url", default="")
    p.add_argument("--url-template", default="")
    p.add_argument("--year", type=int)
    p.add_argument("--month", type=int)
    p.add_argument("--topic", action="append", default=[])
    p.add_argument("--publisher", default="")
    p.add_argument("--notes", default="")

    p = sub.add_parser("add-deadline")
    p.add_argument("id"); p.add_argument("name"); p.add_argument("date", nargs="?")
    p.add_argument("--track", default="")

    p = sub.add_parser("verify")
    p.add_argument("id")
    p.add_argument("--source", required=True, help="the first-party page you read the date on")
    p.add_argument("--deadline", help="which deadline, by name (default: all of the current cycle)")
    p.add_argument("--date", help="correct the date while verifying")

    p = sub.add_parser("set"); p.add_argument("id"); p.add_argument("field"); p.add_argument("value")

    args = ap.parse_args()
    handlers = {"show": cmd_show, "queue": cmd_queue, "add-venue": cmd_add_venue,
                "add-deadline": cmd_add_deadline, "verify": cmd_verify, "set": cmd_set}
    read_only = args.cmd in ("show", "queue")
    try:
        with db.session(write_dump=not read_only) as conn:
            handlers[args.cmd](conn, args)
            if not read_only:
                errors, _ = db.check(conn)
                if errors:
                    print("\n".join(errors), file=sys.stderr)
                    raise SystemExit("not saved: the change fails validation")
    except db.sqlite3.IntegrityError as exc:
        # a schema rule, e.g. "verified needs a source" or "url must be http"
        raise SystemExit(f"not saved: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
