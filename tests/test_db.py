"""The dump is the source of truth: building and dumping it again must give
the same text, and the schema must refuse what the rules forbid."""

import sqlite3

import pytest

import db


def test_build_then_dump_reproduces_the_committed_dump(built, tmp_path):
    out = tmp_path / "again.sql"
    c = db._open(built)
    db.dump(c, out)
    c.close()
    assert out.read_text(encoding="utf-8") == db.DUMP.read_text(encoding="utf-8")


def test_the_committed_data_passes_check(conn):
    errors, _ = db.check(conn)
    assert errors == []


def test_a_verified_deadline_needs_a_source(conn):
    venue = conn.execute("SELECT id, year FROM venues WHERE year IS NOT NULL LIMIT 1").fetchone()
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO deadlines (venue_id, cycle_year, position, name, date, status, source) "
                     "VALUES (?, ?, 99, 'Paper', '2030-01-01T23:59:00-12:00', 'verified', '')",
                     (venue["id"], venue["year"]))


def test_unknown_tiers_and_statuses_are_refused(conn):
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE venues SET tier = 'legendary' WHERE rowid = (SELECT min(rowid) FROM venues)")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE deadlines SET status = 'probably' WHERE rowid = (SELECT min(rowid) FROM deadlines)")


def test_check_flags_a_duplicate_opportunity_number(conn):
    a, b = conn.execute("SELECT id FROM grants ORDER BY id LIMIT 2").fetchall()
    conn.execute("UPDATE grants SET opportunity_number = 'TEST-1' WHERE id IN (?, ?)", (a["id"], b["id"]))
    errors, _ = db.check(conn)
    assert any("TEST-1" in e for e in errors)
