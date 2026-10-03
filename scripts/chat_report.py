#!/usr/bin/env python3
"""A week of questions asked to the White Rabbit chat assistant, as a Google
Chat post: how many, how they were rated, the ones it had no data for, and
venues people asked about that the site does not track.

Reads the JSON that `wrangler d1 execute --json` prints for the week's rows.

  python scripts/chat_report.py questions/2026-10-05.json
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402
import notify_chat  # noqa: E402

SHOWN = 8


def rows_of(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    # wrangler prints [{results: [...], success, meta}] per statement
    if isinstance(data, list) and data and isinstance(data[0], dict) and "results" in data[0]:
        return [r for block in data for r in block["results"]]
    return data


def report(rows: list[dict]) -> str:
    if not rows:
        return "*Chat questions this week*\n\nNo questions asked this week."
    up = sum(1 for r in rows if r.get("feedback") == 1)
    down = sum(1 for r in rows if r.get("feedback") == -1)
    gaps = [r["question"] for r in rows if not r.get("matched")]
    disliked = [r["question"] for r in rows if r.get("feedback") == -1]

    # capitalised words that look like venue acronyms but are not tracked
    known = {r["name"].lower() for r in db.connect().execute("SELECT name FROM venues")}
    asked = Counter(w for r in rows for w in set(re.findall(r"\b[A-Z][A-Za-z]*[A-Z][A-Za-z]*\b", r["question"])))
    missing = [f"{w} ({n})" for w, n in asked.most_common() if w.lower() not in known
               and w not in {"PhD", "NSF", "NIH", "DOE", "AI", "ML", "AoE", "NLP", "HCI", "OS", "PL"}][:SHOWN]

    lines = [f"*Chat questions this week*", "",
             f"{len(rows)} question{'s' if len(rows) != 1 else ''} · 👍 {up} · 👎 {down}", ""]
    lines += notify_chat.section("No matching data", [q[:140] for q in gaps])
    lines += notify_chat.section("Marked not helpful", [q[:140] for q in disliked])
    lines += notify_chat.section("Asked about, not tracked", missing)
    return "\n".join(lines).rstrip()


if __name__ == "__main__":
    notify_chat.post(report(rows_of(Path(sys.argv[1]))), "Weekly chat report")
