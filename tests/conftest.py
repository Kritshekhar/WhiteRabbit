"""Shared fixtures. The scripts import each other by name, so their folder goes
on the path; a database built from the committed dump is made once per run."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import db  # noqa: E402


@pytest.fixture(scope="session")
def built(tmp_path_factory) -> Path:
    """A .sqlite built from schema + dump, away from the working copy's."""
    path = tmp_path_factory.mktemp("db") / "test.sqlite"
    db.build(path)
    return path


@pytest.fixture
def conn(built, tmp_path):
    """A private copy of the built database for one test to change freely."""
    copy = tmp_path / "copy.sqlite"
    copy.write_bytes(built.read_bytes())
    c = db._open(copy)
    yield c
    c.close()
