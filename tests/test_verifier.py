"""The date reader and the line matcher in verify_deadlines.py, with the
traps that have caught it before as fixtures."""

from datetime import date

import verify_deadlines as V

VENUE = {"year": 2027}


def paper(iso: str, track: str = "") -> dict:
    return {"date": iso, "name": "Paper submission", "track": track}


def scan(d: dict, text: str):
    return V.scan(VENUE, d, [("https://example.org/cfp", text)])


# --- dates_in ---------------------------------------------------------------
def test_reads_month_first_day_first_and_iso_dates():
    assert V.dates_in("Paper submission: September 17, 2026") == [(date(2026, 9, 17), True)]
    assert V.dates_in("Abstracts due 17th Sept. 2026") == [(date(2026, 9, 17), True)]
    assert V.dates_in("Deadline 2026-09-17") == [(date(2026, 9, 17), True)]


def test_a_date_without_a_year_is_marked_as_such():
    [(_, explicit)] = V.dates_in("Submission deadline: May 8")
    assert explicit is False


def test_impossible_dates_are_skipped():
    assert V.dates_in("February 30, 2026") == []


# --- scan -------------------------------------------------------------------
def test_verifies_when_the_line_states_our_date():
    source, others = scan(paper("2026-10-09T23:59:00-12:00"),
                          "IPDPS 2027\nPaper submission deadline: October 9, 2026")
    assert source == "https://example.org/cfp" and not others


def test_ipdps_abstract_line_does_not_speak_for_the_paper_deadline():
    # the trap: an abstract registration date read as the paper deadline
    source, others = scan(paper("2026-10-09T23:59:00-12:00"),
                          "IPDPS 2027\nAbstract registration: October 2, 2026")
    assert source is None and not others


def test_www_industry_track_line_is_ignored_for_the_research_deadline():
    source, others = scan(paper("2026-10-09T23:59:00-12:00"),
                          "WWW 2027\nIndustry track paper submission deadline: October 30, 2026")
    assert source is None and not others


def test_ndss_stale_page_with_another_years_dates_is_neither_verified_nor_proposed():
    source, others = scan(paper("2026-07-09T23:59:00-12:00"),
                          "NDSS 2027\nPaper submission deadline: July 10, 2024")
    assert source is None and not others


def test_iclr_news_line_is_not_proposed_as_a_deadline():
    source, others = scan(paper("2026-10-01T23:59:00-12:00"),
                          "ICLR 2027\nThe call for papers is posted: September 1, 2026 - submission deadline soon")
    assert source is None and not others


def test_an_extension_beats_the_original_date_on_the_same_line():
    page = "FAST 2027\nPaper submission deadline: September 10, 2026 extended to September 17, 2026"
    assert scan(paper("2026-09-17T23:59:00-12:00"), page)[0]
    assert scan(paper("2026-09-10T23:59:00-12:00"), page)[0] is None


def test_a_different_date_for_the_same_deadline_is_proposed():
    source, others = scan(paper("2026-09-17T23:59:00-12:00"),
                          "FAST 2027\nPaper submission deadline: September 24, 2026")
    assert source is None
    assert others == {(date(2026, 9, 24), "https://example.org/cfp")}


def test_a_page_about_another_edition_is_skipped():
    source, others = scan(paper("2026-09-17T23:59:00-12:00"),
                          "FAST 2025\nPaper submission deadline: September 17")
    assert source is None and not others
