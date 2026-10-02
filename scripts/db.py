#!/usr/bin/env python3
"""The WhiteRabbit database: one SQLite file, rebuilt from a committed text dump.

  db/schema.sql         table definitions
  db/whiterabbit.sql    the data, one row per line - the source of truth in git
  db/whiterabbit.sqlite build artefact, gitignored

Why a dump and not the .sqlite file itself: a binary file in git cannot be read
in a diff, and every weekly sweep is reviewed as a pull request. The dump is
deterministic (rows in primary-key order, one per line), so a PR shows exactly
which rows changed.

Scripts never touch the files directly. They use

    with db.session() as conn:      # rebuilds the .sqlite if the dump moved
        conn.execute(...)           # commits and re-dumps on a clean exit

and readers that change nothing use `db.connect()`.

  python scripts/db.py build    # rebuild the .sqlite from schema + dump
  python scripts/db.py dump     # write the dump from the .sqlite
  python scripts/db.py check    # validate the data (CI runs this)
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import re
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_DIR = ROOT / "db"
SCHEMA = DB_DIR / "schema.sql"
DUMP = DB_DIR / "whiterabbit.sql"
DB_FILE = DB_DIR / "whiterabbit.sqlite"

# Dump order. Parents before children, so the dump loads with foreign keys on.
# Each table's rows are written in this key order, which keeps the dump stable.
TABLES = {
    "meta": "key",
    "venues": "id",
    "deadlines": "id",
    "grants": "id",
    "grant_deadlines": "id",
    "solicitations": "id",
    "proceedings": "venue_id, year",
    "proceedings_topics": "venue_id, year, term",
    "proceedings_keywords": "venue_id, year, term",
    "institutions": "id",
    "proceedings_institutions": "venue_id, year, institution_id",
    "proceedings_countries": "venue_id, year, country",
    "keyword_trends": "year, term",
    "research_eras": "year, rank",
    "tracked_terms": "term",
    "term_venue_year": "term, venue_id, year",
    "venue_similarity": "venue_id, other_id",
    "proceedings_authors": "venue_id, year",
    "top_authors": "scope, rank",
    "changes": "id",
    "candidates": "id",
    "crawl_log": "url",
}
# SQLite caps a multi-row VALUES list at 500 rows.
CHUNK = 400

VALID_TIERS = ("rabbit-hole", "royal-flush", "full-house", "looking-glass")
ELIGIBILITY = ("PhD student", "Postdoc", "Early-career faculty", "Faculty / PI")
# A venue's place on a project's path - see the About page.
STAGES = {
    "rabbit-hole":   (1, "Rabbit Hole"),
    "royal-flush":   (2, "Wonderland"),
    "full-house":    (2, "Wonderland"),
    "looking-glass": (3, "Looking Glass"),
}


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# --------------------------------------------------------------------------
# build and dump
# --------------------------------------------------------------------------
def _dump_digest() -> str:
    material = SCHEMA.read_bytes() + b"\0" + (DUMP.read_bytes() if DUMP.exists() else b"")
    return hashlib.sha1(material).hexdigest()


def _open(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def build(path: Path = DB_FILE) -> None:
    """Create the .sqlite from schema + dump, replacing whatever was there."""
    tmp = path.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    conn = _open(tmp)
    try:
        conn.executescript(SCHEMA.read_text(encoding="utf-8"))
        if DUMP.exists():
            conn.executescript("BEGIN;\n" + DUMP.read_text(encoding="utf-8") + "\nCOMMIT;")
        # Not part of the schema, so it never reaches the dump.
        conn.execute("CREATE TABLE _build (digest TEXT NOT NULL)")
        conn.execute("INSERT INTO _build VALUES (?)", (_dump_digest(),))
        conn.commit()
    finally:
        conn.close()
    tmp.replace(path)


def _is_current(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        conn = sqlite3.connect(path)
        row = conn.execute("SELECT digest FROM _build").fetchone()
        conn.close()
    except sqlite3.Error:
        return False
    return bool(row) and row[0] == _dump_digest()


def connect(path: Path = DB_FILE) -> sqlite3.Connection:
    """Open the database, rebuilding it first if the dump or schema changed."""
    if not _is_current(path):
        build(path)
    return _open(path)


def _literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return str(int(value))
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    text = "'" + str(value).replace("'", "''") + "'"
    # Keep one row per line: a literal newline would split a row across lines.
    return text.replace("\r", "'||char(13)||'").replace("\n", "'||char(10)||'")


def dump(conn: sqlite3.Connection, out: Path = DUMP) -> None:
    lines = ["-- WhiteRabbit data. Generated by scripts/db.py dump; one row per line.",
             "-- Edit with scripts/wr.py, or by hand and then run `python scripts/db.py check`."]
    for table, order in TABLES.items():
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
        rows = conn.execute(f"SELECT {', '.join(cols)} FROM {table} ORDER BY {order}").fetchall()
        if not rows:
            continue
        lines.append("")
        for start in range(0, len(rows), CHUNK):
            lines.append(f"INSERT INTO {table} ({', '.join(cols)}) VALUES")
            chunk = rows[start:start + CHUNK]
            for i, row in enumerate(chunk):
                end = ";" if i == len(chunk) - 1 else ","
                lines.append("(" + ", ".join(_literal(v) for v in row) + ")" + end)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    # The .sqlite now matches the dump, so the next connect() need not rebuild.
    if conn.execute("SELECT name FROM sqlite_master WHERE name = '_build'").fetchone():
        conn.execute("UPDATE _build SET digest = ?", (_dump_digest(),))
        conn.commit()


@contextlib.contextmanager
def session(path: Path = DB_FILE, write_dump: bool = True):
    """A read-write connection that commits and re-dumps on a clean exit."""
    conn = connect(path)
    try:
        yield conn
        conn.commit()
        if write_dump:
            dump(conn)
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


# --------------------------------------------------------------------------
# small helpers shared by the scripts
# --------------------------------------------------------------------------
def jload(text: str | None, default=None):
    if text in (None, ""):
        return default
    return json.loads(text)


def jdump(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def get_meta(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_meta(conn: sqlite3.Connection, key: str, value) -> None:
    conn.execute("INSERT INTO meta (key, value) VALUES (?, ?) "
                 "ON CONFLICT (key) DO UPDATE SET value = excluded.value", (key, str(value)))


def propose(conn: sqlite3.Connection, entity: str, entity_id: str, field: str,
            value, source: str = "") -> None:
    """Queue a value a crawler found but could not confirm."""
    stamp = now_iso()
    conn.execute(
        "INSERT INTO candidates (entity, entity_id, field, proposed_value, source, first_seen, last_checked) "
        "VALUES (?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (entity, entity_id, field, proposed_value) DO UPDATE SET "
        "last_checked = excluded.last_checked, attempts = attempts + 1, "
        "source = CASE WHEN excluded.source <> '' THEN excluded.source ELSE source END",
        (entity, str(entity_id), field, str(value), source, stamp, stamp))


KEEP_CHANGES_DAYS = 365


def record_change(conn: sqlite3.Connection, entity: str, entity_id: str, kind: str, deadline: str = "",
                  before: str | None = "", after: str | None = "", source: str = "") -> None:
    """Log one change for the "What changed" feed, and forget anything older
    than a year so the dump does not grow without bound."""
    conn.execute(
        "INSERT INTO changes (at, entity, entity_id, deadline, kind, before, after, source) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (now_iso(), entity, entity_id, deadline, kind, before or "", after or "", source or ""))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_CHANGES_DAYS)).replace(microsecond=0).isoformat()
    conn.execute("DELETE FROM changes WHERE at < ?", (cutoff,))


def log_fetch(conn: sqlite3.Connection, url: str, status: int | None, body: bytes | None = None) -> None:
    digest = hashlib.sha1(body).hexdigest()[:16] if body else None
    conn.execute("INSERT INTO crawl_log (url, fetched_at, http_status, content_hash) VALUES (?, ?, ?, ?) "
                 "ON CONFLICT (url) DO UPDATE SET fetched_at = excluded.fetched_at, "
                 "http_status = excluded.http_status, content_hash = excluded.content_hash",
                 (url, now_iso(), status, digest))


def insert_venue(conn: sqlite3.Connection, v: dict) -> str:
    """Add a venue (as update.normalise() shapes it) at the end of the list."""
    position = conn.execute("SELECT coalesce(max(position), 0) + 1 FROM venues").fetchone()[0]
    conn.execute(
        "INSERT INTO venues (id, position, name, full_name, tier, url, url_template, year, month, "
        "rolling, cycle_years, formats, tracks, topics, publisher, notes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (v["id"], position, v["name"], v["full_name"], v["tier"], v["url"], v["url_template"],
         v["year"], v["month"], int(v["rolling"]), v["cycle_years"], jdump(v["formats"]),
         jdump(v["tracks"]), jdump(v["topics"]), v["publisher"], v["notes"]))
    for i, d in enumerate(v["deadlines"]):
        conn.execute(
            "INSERT INTO deadlines (venue_id, cycle_year, position, name, track, date, status, "
            "source, verified_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (v["id"], v["year"], i, d["name"], d["track"], d["date"],
             "verified" if d["confirmed"] else "unverified", d["source"], d["verified_on"]))
    first = next((d["date"] for d in v["deadlines"] if d["date"]), "")
    record_change(conn, "venue", v["id"], "added", after=first or "", source=v["url"])
    return v["id"]


def insert_grant(conn: sqlite3.Connection, g: dict) -> str:
    """Add a grant (and its deadlines) at the end of the list. Returns its id."""
    gid = slugify(g["name"])
    position = conn.execute("SELECT coalesce(max(position), 0) + 1 FROM grants").fetchone()[0]
    conn.execute(
        "INSERT INTO grants (id, position, name, funder, also_funded_by, eligibility, url, amount, "
        "opportunity_number, topics, notes, ccs, ccs_auto, funding, typical_window, last_checked, "
        "solicitation, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (gid, position, g["name"], g.get("funder", ""), jdump(g.get("also_funded_by") or []),
         g.get("eligibility") or "Faculty / PI", g.get("url", ""), g.get("amount", ""),
         g.get("opportunity_number", ""), jdump(g.get("topics") or []), g.get("notes", ""),
         g.get("ccs", ""), int(bool(g.get("ccs_auto"))), jdump(g.get("funding") or {}),
         g.get("typical_window", ""), g.get("last_checked", ""), g.get("solicitation", ""),
         g.get("source", "")))
    for i, d in enumerate(g.get("deadlines") or []):
        conn.execute(
            "INSERT INTO grant_deadlines (grant_id, position, name, date, status, source, verified_on) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (gid, i, d.get("name") or "Application", d.get("date"),
             "verified" if d.get("confirmed") else "unverified", d.get("source") or "",
             d.get("verified_on") or ""))
    first = next((d.get("date") for d in g.get("deadlines") or [] if d.get("date")), "")
    record_change(conn, "grant", gid, "added", after=first or "", source=g.get("url", ""))
    return gid


# --------------------------------------------------------------------------
# records in the shape the front end reads (data/*.json)
# --------------------------------------------------------------------------
def venue_records(conn: sqlite3.Connection) -> list[dict]:
    """Every venue with its current cycle's deadlines."""
    out = []
    for v in conn.execute("SELECT * FROM venues ORDER BY position"):
        rows = conn.execute(
            "SELECT * FROM deadlines WHERE venue_id = ? AND cycle_year IS ? ORDER BY position",
            (v["id"], v["year"])).fetchall()
        stage = STAGES.get(v["tier"], (2, ""))
        out.append({
            "id": v["id"],
            "name": v["name"],
            "full_name": v["full_name"],
            "tier": v["tier"],
            "url": v["url"],
            "url_template": v["url_template"],
            "year": v["year"],
            "month": v["month"],
            "stage": stage[0],
            "stage_name": stage[1],
            "rolling": bool(v["rolling"]),
            "cycle_years": v["cycle_years"],
            "formats": jload(v["formats"], []),
            "tracks": jload(v["tracks"], []),
            "topics": jload(v["topics"], []),
            "publisher": v["publisher"],
            "notes": v["notes"],
            "deadlines": [{
                "name": d["name"],
                "date": d["date"],
                "confirmed": d["status"] == "verified",
                "track": d["track"],
                "source": d["source"],
                "verified_on": d["verified_on"],
            } for d in rows],
            "link_status": v["link_status"],
            "link_checked_on": v["link_checked_on"],
        })
    return out


def grant_records(conn: sqlite3.Connection) -> list[dict]:
    out = []
    for g in conn.execute("SELECT * FROM grants ORDER BY position"):
        rows = conn.execute("SELECT * FROM grant_deadlines WHERE grant_id = ? ORDER BY position",
                            (g["id"],)).fetchall()
        out.append({
            "id": g["id"],
            "name": g["name"],
            "funder": g["funder"],
            "also_funded_by": jload(g["also_funded_by"], []),
            "eligibility": g["eligibility"],
            "url": g["url"],
            "amount": g["amount"],
            "opportunity_number": g["opportunity_number"],
            "topics": jload(g["topics"], []),
            "notes": g["notes"],
            "ccs": g["ccs"],
            "ccs_auto": bool(g["ccs_auto"]),
            "funding": jload(g["funding"], {}),
            "typical_window": g["typical_window"],
            "last_checked": g["last_checked"],
            "deadlines": [{
                "name": d["name"],
                "date": d["date"],
                "confirmed": d["status"] == "verified",
                "source": d["source"],
            } for d in rows],
            "link_status": g["link_status"],
        })
    return out


# --------------------------------------------------------------------------
# validation - what the schema's CHECK constraints cannot express
# --------------------------------------------------------------------------
PLACEHOLDER = re.compile(r"\{(year|yyyy|yy|yyn)\}")


def _check_date(where: str, value: str | None, errors: list, max_year: int) -> None:
    if value is None:
        return
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        errors.append(f"ERROR  {where}: date {value!r} is not ISO 8601")
        return
    if parsed.tzinfo is None:
        errors.append(f"ERROR  {where}: date {value!r} has no timezone offset (use -12:00 for AoE)")
    if not 2000 <= parsed.year <= max_year:
        errors.append(f"ERROR  {where}: date {value!r} has an implausible year")


def check(conn: sqlite3.Connection) -> tuple[list[str], list[str]]:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from lib_ccs import CLASSES  # noqa: E402

    errors: list[str] = []
    warnings: list[str] = []

    def lists(where: str, row, fields) -> None:
        for field in fields:
            try:
                value = json.loads(row[field])
            except (TypeError, ValueError):
                value = None
            if not isinstance(value, list):
                errors.append(f"ERROR  {where}: {field} must be a JSON list")

    for v in conn.execute("SELECT * FROM venues ORDER BY position"):
        where = v["name"]
        if v["id"] != slugify(v["name"]):
            errors.append(f"ERROR  {where}: id {v['id']!r} should be {slugify(v['name'])!r}")
        if v["url_template"] and not PLACEHOLDER.search(v["url_template"]):
            errors.append(f"ERROR  {where}: url_template has no {{year}}/{{yy}} placeholder")
        lists(where, v, ("formats", "tracks", "topics"))
        current = conn.execute("SELECT * FROM deadlines WHERE venue_id = ? AND cycle_year IS ?",
                               (v["id"], v["year"])).fetchall()
        if v["rolling"] and current:
            warnings.append(f"WARN   {where}: rolling but deadlines are listed")
        if not v["rolling"] and not current:
            warnings.append(f"WARN   {where}: no deadlines - renders as TBA")

    for d in conn.execute("SELECT * FROM deadlines"):
        _check_date(f"{d['venue_id']} deadline {d['name']!r}", d["date"], errors, 2100)

    max_grant_year = datetime.now().year + 6
    for g in conn.execute("SELECT * FROM grants ORDER BY position"):
        where = g["name"]
        if g["id"] != slugify(g["name"]):
            errors.append(f"ERROR  {where}: id {g['id']!r} should be {slugify(g['name'])!r}")
        if g["ccs"] and g["ccs"] not in CLASSES:
            errors.append(f"ERROR  {where}: ccs {g['ccs']!r} is not an ACM CCS top-level class")
        lists(where, g, ("also_funded_by", "topics"))
        if not isinstance(jload(g["funding"], None), dict):
            errors.append(f"ERROR  {where}: funding must be a JSON object")

    # one funding opportunity listed twice under different names
    for row in conn.execute("SELECT opportunity_number, group_concat(name, ' | ') AS names FROM grants "
                            "WHERE opportunity_number <> '' GROUP BY opportunity_number HAVING count(*) > 1"):
        errors.append(f"ERROR  opportunity {row['opportunity_number']} is listed twice: {row['names']}")

    for d in conn.execute("SELECT * FROM grant_deadlines"):
        # a deadline decades out is a grants.gov placeholder, not a date
        _check_date(f"{d['grant_id']} deadline {d['name']!r}", d["date"], errors, max_grant_year)

    for p in conn.execute("SELECT * FROM proceedings"):
        if p["accepted_count"] is not None and p["submitted_count"] is not None \
                and p["accepted_count"] > p["submitted_count"]:
            errors.append(f"ERROR  {p['venue_id']} {p['year']}: more papers accepted than submitted")

    for problem in conn.execute("PRAGMA foreign_key_check"):
        errors.append(f"ERROR  {problem[0]} row {problem[1]}: dangling reference to {problem[2]}")
    return errors, warnings


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("command", choices=("build", "dump", "check"))
    ap.add_argument("--strict", action="store_true", help="check: warnings fail too")
    args = ap.parse_args()

    if args.command == "build":
        build()
        conn = _open(DB_FILE)
        counts = {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in TABLES}
        print(f"Built {DB_FILE.relative_to(ROOT)}: " +
              ", ".join(f"{n} {t}" for t, n in counts.items() if n))
        return 0
    if args.command == "dump":
        conn = _open(DB_FILE)
        dump(conn)
        print(f"Wrote {DUMP.relative_to(ROOT)}")
        return 0

    conn = connect()
    errors, warnings = check(conn)
    for line in warnings:
        print(line)
    for line in errors:
        print(line, file=sys.stderr)
    venues = conn.execute("SELECT count(*) FROM venues").fetchone()[0]
    grants = conn.execute("SELECT count(*) FROM grants").fetchone()[0]
    print(f"\n{venues} venues and {grants} grants checked - "
          f"{len(errors)} error(s), {len(warnings)} warning(s)")
    if errors:
        return 1
    return 1 if (args.strict and warnings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
