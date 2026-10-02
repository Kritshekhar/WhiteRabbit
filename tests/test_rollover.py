"""A venue whose cycle is over moves to next year's site, with its deadlines
shifted and unverified, and the move can be undone."""

from datetime import timedelta

import db
import update


def first_rollable(conn):
    for record in db.venue_records(conn):
        venue = update.normalise(record)
        if venue["url_template"] and not venue["rolling"] and any(d["_dt"] for d in venue["deadlines"]):
            return venue
    raise AssertionError("no venue with a template and dates")


def test_rolls_over_to_next_year_and_undoes(conn, monkeypatch):
    monkeypatch.setattr(update, "probe", lambda url: "ok")
    monkeypatch.setattr(update, "page_mentions_year", lambda url, year: True)
    venue = first_rollable(conn)
    year, step = venue["year"], venue["cycle_years"]
    after_cycle = max(d["_dt"] for d in venue["deadlines"] if d["_dt"]) + timedelta(days=60)

    before = update.roll_over_cycle(conn, venue, after_cycle, 30, True)

    assert before == (year, venue["url"])
    row = conn.execute("SELECT year, url FROM venues WHERE id = ?", (venue["id"],)).fetchone()
    assert row["year"] == year + step
    assert row["url"] == update.render_template(venue["url_template"], year + step)
    new = conn.execute("SELECT status, date FROM deadlines WHERE venue_id = ? AND cycle_year = ?",
                       (venue["id"], year + step)).fetchall()
    assert new and all(r["status"] == "unverified" for r in new)
    kinds = [r["kind"] for r in conn.execute("SELECT kind FROM changes WHERE entity_id = ?", (venue["id"],))]
    assert "rolled_over" in kinds

    update.undo_rollover(conn, venue["id"], before)
    row = conn.execute("SELECT year, url FROM venues WHERE id = ?", (venue["id"],)).fetchone()
    assert (row["year"], row["url"]) == (year, venue["url"])
    assert not conn.execute("SELECT 1 FROM deadlines WHERE venue_id = ? AND cycle_year = ?",
                            (venue["id"], year + step)).fetchone()


def test_does_not_roll_while_the_cycle_is_running(conn, monkeypatch):
    monkeypatch.setattr(update, "probe", lambda url: "ok")
    monkeypatch.setattr(update, "page_mentions_year", lambda url, year: True)
    venue = first_rollable(conn)
    during = max(d["_dt"] for d in venue["deadlines"] if d["_dt"]) - timedelta(days=1)
    assert update.roll_over_cycle(conn, venue, during, 30, True) is None


def test_does_not_roll_when_next_years_site_is_not_live(conn, monkeypatch):
    monkeypatch.setattr(update, "probe", lambda url: "dead")
    venue = first_rollable(conn)
    after_cycle = max(d["_dt"] for d in venue["deadlines"] if d["_dt"]) + timedelta(days=60)
    assert update.roll_over_cycle(conn, venue, after_cycle, 30, True) is None
