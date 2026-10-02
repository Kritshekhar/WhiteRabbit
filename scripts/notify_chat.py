#!/usr/bin/env python3
"""Post White Rabbit updates to a Google Chat space.

The space's incoming-webhook URL is read from GOOGLE_CHAT_WEBHOOK (a secret in
both repositories). Without it, or when Chat cannot be reached, this prints
the message and exits 0: a notification never fails the job that sends it.

  python scripts/notify_chat.py message "Site deployed"
  python scripts/notify_chat.py digest              # what changed in the data, last 24 hours
  python scripts/notify_chat.py proceedings         # proceedings years changed since the last data commit
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402

HOME = "https://kritshekhar.github.io/WhiteRabbit/"
ICON = HOME + "apple-touch-icon.png"     # the site's logo, shown on every message
LIMIT = 3800        # Chat allows more, but a long message is not read
SHOWN = 12          # items listed per section before "and N more"


def card(text: str, subtitle: str = "") -> dict:
    """A Chat card with the White Rabbit logo in its header. The message is
    written in Chat's plain-text style (*bold*, <url|label>) and converted to
    the HTML subset cards use."""
    body = html.escape(text, quote=False)
    body = re.sub(r"&lt;(https?://[^|&]+)\|([^&]+?)&gt;", r'<a href="\1">\2</a>', body)
    body = re.sub(r"\*([^*\n]+)\*", r"<b>\1</b>", body)
    body = re.sub(r"`([^`\n]+)`", r"<font color='#6f6e68'>\1</font>", body)
    return {"cardsV2": [{"cardId": "whiterabbit", "card": {
        "header": {"title": "White Rabbit", "subtitle": subtitle, "imageUrl": ICON, "imageType": "SQUARE"},
        "sections": [{"widgets": [{"textParagraph": {"text": body.replace("\n", "<br>")}}]}],
    }}]}


def post(text: str, subtitle: str = "") -> None:
    print(text)
    url = os.environ.get("GOOGLE_CHAT_WEBHOOK", "").strip()
    if not url:
        print("(GOOGLE_CHAT_WEBHOOK not set, not sent)", file=sys.stderr)
        return
    if len(text) > LIMIT:
        text = text[:LIMIT] + "\n…"
    req = urllib.request.Request(url, data=json.dumps(card(text, subtitle)).encode(),
                                 headers={"Content-Type": "application/json; charset=UTF-8"})
    try:
        urllib.request.urlopen(req, timeout=20).read()
    except Exception as e:  # noqa: BLE001 - a failed notification must not fail the job
        print(f"(could not post to Google Chat: {e})", file=sys.stderr)


def link(entity: str, entity_id: str, name: str) -> str:
    path = "conferences" if entity == "venue" else "grants"
    return f"<{HOME}{path}/{entity_id}/|{name}>"


def day(iso: str) -> str:
    return iso[:10] if iso else "?"


def section(title: str, lines: list[str]) -> list[str]:
    if not lines:
        return []
    more = [f"  …and {len(lines) - SHOWN} more"] if len(lines) > SHOWN else []
    return [f"*{title}* ({len(lines)})"] + [f"• {line}" for line in lines[:SHOWN]] + more + [""]


def digest(conn: sqlite3.Connection, hours: int) -> str:
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).replace(microsecond=0).isoformat()
    names = {("venue", r["id"]): r["name"] for r in conn.execute("SELECT id, name FROM venues")}
    names |= {("grant", r["id"]): r["name"] for r in conn.execute("SELECT id, name FROM grants")}
    groups: dict[str, list[str]] = {"verified": [], "corrected": [], "rolled_over": [], "added": [], "removed": []}
    for c in conn.execute("SELECT * FROM changes WHERE at >= ? ORDER BY at", (since,)):
        who = link(c["entity"], c["entity_id"], names.get((c["entity"], c["entity_id"]), c["entity_id"]))
        what = f" · {c['deadline']}" if c["deadline"] else ""
        if c["kind"] == "verified":
            groups["verified"].append(f"{who}{what}: {day(c['after'])}")
        elif c["kind"] == "corrected":
            groups["corrected"].append(f"{who}{what}: {day(c['before'])} → {day(c['after'])}")
        elif c["kind"] == "rolled_over":
            groups["rolled_over"].append(f"{who}: {c['before']} → {c['after']}")
        else:
            groups[c["kind"]].append(f"{who}{what}")
    queue = conn.execute("SELECT count(*) FROM candidates WHERE status = 'open'").fetchone()[0]

    lines = [f"*White Rabbit daily digest* · {datetime.now(timezone.utc):%Y-%m-%d}", ""]
    lines += section("Newly verified", groups["verified"])
    lines += section("Corrected", groups["corrected"])
    lines += section("Moved to next year's cycle", groups["rolled_over"])
    lines += section("Added", groups["added"])
    lines += section("Removed", groups["removed"])
    if not any(groups.values()):
        lines += ["No deadline changes in the last day.", ""]
    lines.append(f"Review queue: {queue} proposal{'s' if queue != 1 else ''} waiting "
                 "(`python scripts/wr.py queue`).")
    return "\n".join(lines)


def proceedings(conn: sqlite3.Connection) -> str | None:
    """Proceedings rows that differ from the last committed dump."""
    old = subprocess.run(["git", "-C", str(db.DATA_DIR), "show", "HEAD:whiterabbit.sql"],
                         capture_output=True, text=True)
    if old.returncode:
        print(f"(no committed dump to compare with: {old.stderr.strip()})", file=sys.stderr)
        return None
    with tempfile.TemporaryDirectory() as tmp:
        prev = sqlite3.connect(Path(tmp) / "prev.sqlite")
        prev.executescript(db.SCHEMA.read_text(encoding="utf-8"))
        prev.executescript("BEGIN;\n" + old.stdout + "\nCOMMIT;")
        before = {(r[0], r[1]): r[2:] for r in prev.execute(
            "SELECT venue_id, year, accepted_count, acceptance_rate FROM proceedings")}
        prev.close()
    names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM venues")}
    added, changed, rates = [], [], []
    for r in conn.execute("SELECT venue_id, year, accepted_count, acceptance_rate FROM proceedings "
                          "ORDER BY venue_id, year"):
        key, now = (r[0], r[1]), (r[2], r[3])
        who = link("venue", r[0], f"{names.get(r[0], r[0])} {r[1]}")
        if key not in before:
            added.append(f"{who}: {r[2]:,} papers" if r[2] else who)
        elif before[key] != now:
            was_count, was_rate = before[key]
            if was_count != r[2]:
                changed.append(f"{who}: {was_count or 0:,} → {r[2] or 0:,} papers")
            if was_rate != r[3] and r[3] is not None:
                rates.append(f"{who}: {r[3]:.0%}" if r[3] <= 1 else f"{who}: {r[3]}%")
    if not (added or changed or rates):
        return None
    lines = [f"*Proceedings stats updated* · {datetime.now(timezone.utc):%Y-%m-%d}", ""]
    lines += section("New venue-years", added) + section("Paper counts changed", changed)
    lines += section("Acceptance rates", rates)
    return "\n".join(lines).rstrip()


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("message")
    m.add_argument("text")
    m.add_argument("--subtitle", default="")
    d = sub.add_parser("digest")
    d.add_argument("--hours", type=int, default=24)
    sub.add_parser("proceedings")
    args = ap.parse_args()

    if args.cmd == "message":
        post(args.text, args.subtitle)
        return 0
    conn = db.connect()
    text = digest(conn, args.hours) if args.cmd == "digest" else proceedings(conn)
    if text:
        title, _, rest = text.partition("\n")
        post(rest.strip(), title.strip("*").replace("*", ""))
    else:
        print("nothing to report")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
