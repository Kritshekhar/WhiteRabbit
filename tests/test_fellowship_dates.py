"""The fellowship finder reads deadline lines only, and never the date
reference letters are due (the GRFP trap)."""

from datetime import date, timedelta

import fellowship_dates as F


def say(d: date) -> str:
    return d.strftime("%B %-d, %Y")


def test_reads_an_upcoming_application_deadline():
    due = date.today() + timedelta(days=40)
    found = F.dates_on([("https://example.org", f"Applications due {say(due)}")])
    assert list(found) == [due]


def test_skips_reference_letters_opening_dates_and_past_dates():
    soon = date.today() + timedelta(days=40)
    text = "\n".join([
        f"Reference letters due {say(soon)}",
        f"Applications open {say(soon)}",
        f"Deadline was {say(date.today() - timedelta(days=5))}",
    ])
    assert F.dates_on([("https://example.org", text)]) == {}


def test_dates_too_far_ahead_are_not_trusted():
    far = date.today() + timedelta(days=600)
    assert F.dates_on([("https://example.org", f"Submission deadline {say(far)}")]) == {}
