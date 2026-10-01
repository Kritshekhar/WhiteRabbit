#!/usr/bin/env python3
"""Probe every funding link, store the results, and rebuild data/grants.json.

Mirrors scripts/update.py. Countdowns are computed in the browser from the ISO
dates, so this never stores day counts.

  python scripts/update_grants.py               # probe links
  python scripts/update_grants.py --no-network  # rebuild JSON only
"""

from __future__ import annotations

import argparse
import concurrent.futures
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402
import export_json  # noqa: E402

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
TIMEOUT = 15
WORKERS = 8


def probe(url: str) -> tuple[str, int | None]:
    if not url:
        return "unknown", None
    code = None
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(url, method=method, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return ("ok" if 200 <= resp.status < 400 else "dead"), resp.status
        except urllib.error.HTTPError as exc:
            code = exc.code
            if exc.code in (403, 405, 406, 429):
                continue
            return ("dead" if exc.code in (404, 410) else "unknown"), code
        except Exception:
            continue
    return "unknown", code


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-network", action="store_true")
    args = ap.parse_args()

    conn = db.connect()
    grants = conn.execute("SELECT id, name, url FROM grants ORDER BY position").fetchall()
    print(f"Loaded {len(grants)} grants from {db.DUMP.relative_to(db.ROOT)}")

    if not args.no_network:
        print(f"Probing {len(grants)} links ...")
        with concurrent.futures.ThreadPoolExecutor(WORKERS) as pool:
            for g, (status, code) in zip(grants, pool.map(probe, (x["url"] for x in grants))):
                conn.execute("UPDATE grants SET link_status = ? WHERE id = ?", (status, g["id"]))
                if g["url"]:
                    db.log_fetch(conn, g["url"], code)
        dead = [r["name"] for r in conn.execute("SELECT name FROM grants WHERE link_status = 'dead'")]
        if dead:
            print(f"  ! dead links ({len(dead)}): {', '.join(dead[:6])}", file=sys.stderr)
        conn.commit()
        db.dump(conn)

    export_json.export(conn)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
