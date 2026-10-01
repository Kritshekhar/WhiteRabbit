#!/usr/bin/env python3
"""Count every tracked venue's published papers, year by year, from DBLP.

DBLP is the reference bibliography for computer science, and its full XML dump
is free. Its search API now sits behind a bot challenge, so a script cannot use
it; the dump is also the better tool for full history anyway, since one 1.1 GB
download covers every venue and year, where the API would take thousands of
calls.

  1. download   cache/dblp.xml.gz + cache/dblp.dtd (monthly; skipped if fresh)
  2. parse      stream the dump once, keep papers of tracked venues in
                cache/papers.sqlite (gitignored - too big for git)
  3. map        match venues to DBLP streams (conf/fast, journals/tos, ...).
                Only an exact name match is applied; anything looser goes to
                the candidates queue for a person to confirm.
  4. aggregate  papers per venue per year -> the proceedings table, and the
                most distinctive title keywords -> proceedings_keywords

Verification: a finished year's count is marked verified with its DBLP table of
contents as the source, and is never recomputed. The current year stays
unverified, because its proceedings may still be filling in.

What is counted is "papers in the main proceedings on DBLP": research papers,
plus whatever short papers the venue publishes in the same volume. Workshop
volumes, front matter and keynotes are excluded. It is not an acceptance count
in the strict sense, and the site says so.

  python scripts/proceedings_dblp.py                 # all steps
  python scripts/proceedings_dblp.py --skip-download # reuse the cached dump
  python scripts/proceedings_dblp.py --map-only      # just propose dblp keys
"""

from __future__ import annotations

import argparse
import gzip
import math
import re
import sqlite3
import sys
import time
import urllib.request
import xml.parsers.expat
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402

CACHE = db.ROOT / "cache"
DUMP_GZ = CACHE / "dblp.xml.gz"
DTD = CACHE / "dblp.dtd"
PAPERS = CACHE / "papers.sqlite"
DUMP_URL = "https://dblp.org/xml/dblp.xml.gz"
DTD_URL = "https://dblp.org/xml/dblp.dtd"
UA = "WhiteRabbit-stats/1.0 (+https://github.com/Kritshekhar/WhiteRabbit)"
MAX_AGE_DAYS = 30           # DBLP publishes a new dump continuously; monthly is plenty
TOP_KEYWORDS = 30           # per venue per year, to keep the committed dump small

# Venues whose DBLP stream is not simply conf/<name>: DBLP's long-standing names
# for them (NeurIPS is still conf/nips, USENIX Security is conf/uss).
KNOWN_KEYS = {
    "neurips": "conf/nips",
    "usenix-security": "conf/uss",
    "atc": "conf/usenix",
    "s-p": "conf/sp",
    "socc": "conf/cloud",
    "vldb": "journals/pvldb",
    "acm-tos": "journals/tos",
    "acm-tocs": "journals/tocs",
    "hot-chips": "conf/hotchips",
    "ieee-cec": "conf/cec",
}

# Titles that are front matter, not papers.
NOT_A_PAPER = re.compile(
    r"(?i)^(front matter|frontmatter|preface|foreword|editorial|message from|welcome|"
    r"keynote|invited talk|table of contents|author index|program committee|"
    r"organizing committee|proceedings of|session details|title page)")

STOPWORDS = set("""
a an the and or of for in on to with without via from by at as is are be using use
towards toward into over under about through based new novel approach approaches method
methods paper study analysis case its their our we can do does not than vs versus beyond
efficient effective improving improved improve learning large scale fast via more less
when what how why which where all any one two three high low system systems
model models data framework frameworks problem problems result results task tasks
application applications performance design general generalized simple better
report proceedings workshop session special issue track tutorial panel poster
posters demo demos extended abstract abstracts invited talk keynote overview
enhancing enhanced enhance enabling enable leveraging exploring rethinking revisiting understanding unified
""".split())
# venue-and-year tokens such as "sc25" or "2024" say nothing about the research
NOISE_TOKEN = re.compile(r"^(\d+|[a-z]+\d{2,4})$")
TRENDS_YEARS = 10           # trend lists for this many recent complete years
TOP_TRENDS = 30
WORD = re.compile(r"[a-z][a-z0-9\-]+")


# --------------------------------------------------------------------------
# 1. download
# --------------------------------------------------------------------------
def download(force: bool = False) -> None:
    CACHE.mkdir(exist_ok=True)
    fresh = DUMP_GZ.exists() and (time.time() - DUMP_GZ.stat().st_mtime) < MAX_AGE_DAYS * 86400
    if fresh and DTD.exists() and not force:
        print(f"dump is fresh ({DUMP_GZ.stat().st_size / 1e9:.2f} GB), not downloading")
        return
    for url, path in ((DTD_URL, DTD), (DUMP_URL, DUMP_GZ)):
        print(f"downloading {url} ...")
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        tmp = path.with_suffix(".part")
        with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as out:
            while chunk := resp.read(1 << 20):
                out.write(chunk)
        tmp.replace(path)


# --------------------------------------------------------------------------
# 2. parse
# --------------------------------------------------------------------------
RECORDS = {"inproceedings", "article"}
# A <proceedings> record describes a volume itself: its title and, in <ee>, the
# publisher's page for it (ACM DL, USENIX, IEEE Xplore, PMLR, OpenReview, ...).
VOLUME = "proceedings"


def parse(streams: set[str]) -> int:
    """Stream the dump and keep papers whose key is in a wanted stream.

    `streams` holds DBLP stream prefixes such as "conf/fast". An empty set
    keeps a key census only (for mapping), which is what --map-only needs.
    """
    out = sqlite3.connect(PAPERS)
    out.executescript("""
        DROP TABLE IF EXISTS papers;
        DROP TABLE IF EXISTS streams;
        DROP TABLE IF EXISTS wanted;
        DROP TABLE IF EXISTS volumes;
        CREATE TABLE volumes (key TEXT PRIMARY KEY, stream TEXT, year INTEGER, toc TEXT,
                              title TEXT, ee TEXT);
        CREATE TABLE papers (key TEXT PRIMARY KEY, stream TEXT, year INTEGER, toc TEXT,
                             title TEXT, doi TEXT, booktitle TEXT);
        CREATE TABLE streams (stream TEXT PRIMARY KEY, booktitle TEXT, papers INTEGER);
        CREATE TABLE wanted (stream TEXT PRIMARY KEY);
    """)
    out.executemany("INSERT INTO wanted VALUES (?)", [(s,) for s in sorted(streams)])
    census: Counter = Counter()
    labels: dict[str, Counter] = defaultdict(Counter)
    batch: list[tuple] = []
    volumes: list[tuple] = []
    state = {"rec": None, "field": None, "text": []}

    def start(name, attrs):
        if name in RECORDS or name == VOLUME:
            state["rec"] = {"key": attrs.get("key", ""), "ee": []}
        elif state["rec"] is not None and name in ("title", "year", "booktitle", "journal", "url", "ee"):
            state["field"], state["text"] = name, []

    def chars(data):
        if state["field"]:
            state["text"].append(data)

    def end(name):
        rec = state["rec"]
        if rec is None:
            return
        if name == state["field"]:
            text = "".join(state["text"]).strip()
            if name == "ee":
                rec["ee"].append(text)
            else:
                rec[name] = text
            state["field"] = None
        elif name == VOLUME:
            state["rec"] = None
            parts = rec["key"].split("/")
            stream = "/".join(parts[:2])
            if len(parts) < 3 or stream not in streams:
                return
            year = int(rec["year"]) if rec.get("year", "").isdigit() else None
            toc = rec.get("url", "").split("#", 1)[0]
            # prefer the publisher's own page over a DOI redirect when both
            # exist; DBLP also lists catalogue entries (Wikidata) that are not
            # somewhere to read the papers
            links = [e for e in rec["ee"] if "wikidata.org" not in e]
            ee = next((e for e in links if "doi.org/" not in e), links[0] if links else "")
            volumes.append((rec["key"], stream, year, toc, rec.get("title", ""), ee))
        elif name in RECORDS:
            state["rec"] = None
            parts = rec["key"].split("/")
            if len(parts) < 3:
                return
            stream = "/".join(parts[:2])
            census[stream] += 1
            label = rec.get("booktitle") or rec.get("journal") or ""
            if len(labels[stream]) < 50 or label in labels[stream]:
                labels[stream][label] += 1
            if stream not in streams:
                return
            doi = next((e.split("doi.org/", 1)[1] for e in rec["ee"] if "doi.org/" in e), "")
            toc = rec.get("url", "").split("#", 1)[0]
            year = int(rec["year"]) if rec.get("year", "").isdigit() else None
            batch.append((rec["key"], stream, year, toc, rec.get("title", ""), doi.lower(), label))
            if len(batch) >= 5000:
                out.executemany("INSERT OR REPLACE INTO papers VALUES (?, ?, ?, ?, ?, ?, ?)", batch)
                batch.clear()

    parser = xml.parsers.expat.ParserCreate()
    # dblp.xml spells accented names as entities defined in dblp.dtd
    parser.SetParamEntityParsing(xml.parsers.expat.XML_PARAM_ENTITY_PARSING_ALWAYS)

    def external(context, base, system_id, public_id):
        sub = parser.ExternalEntityParserCreate(context)
        sub.Parse(DTD.read_bytes(), True)
        return 1

    parser.ExternalEntityRefHandler = external
    parser.StartElementHandler = start
    parser.EndElementHandler = end
    parser.CharacterDataHandler = chars
    parser.buffer_text = True

    started = time.time()
    with gzip.open(DUMP_GZ, "rb") as fh:
        while chunk := fh.read(1 << 22):
            parser.Parse(chunk, False)
        parser.Parse(b"", True)
    if batch:
        out.executemany("INSERT OR REPLACE INTO papers VALUES (?, ?, ?, ?, ?, ?, ?)", batch)
    out.executemany("INSERT OR REPLACE INTO volumes VALUES (?, ?, ?, ?, ?, ?)", volumes)
    out.executemany("INSERT INTO streams VALUES (?, ?, ?)",
                    [(s, labels[s].most_common(1)[0][0] if labels[s] else "", n) for s, n in census.items()])
    out.commit()
    kept = out.execute("SELECT count(*) FROM papers").fetchone()[0]
    out.close()
    print(f"parsed {sum(census.values()):,} records in {time.time() - started:.0f}s, "
          f"kept {kept:,} papers from {len(streams)} venue streams")
    return kept


# --------------------------------------------------------------------------
# 3. map venues to DBLP streams
# --------------------------------------------------------------------------
def papers_current(streams: set[str]) -> bool:
    """Is cache/papers.sqlite already a parse of this dump for these venues?"""
    if not PAPERS.exists() or PAPERS.stat().st_mtime < DUMP_GZ.stat().st_mtime:
        return False
    try:
        con = sqlite3.connect(PAPERS)
        had = {r[0] for r in con.execute("SELECT stream FROM wanted")}
        con.execute("SELECT 1 FROM volumes LIMIT 1")   # parsed before volumes existed?
        con.close()
    except sqlite3.Error:
        return False
    return had == streams


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def map_venues(conn) -> None:
    papers = sqlite3.connect(PAPERS)
    streams = {r[0]: (r[1], r[2]) for r in papers.execute("SELECT stream, booktitle, papers FROM streams")}
    papers.close()
    applied = proposed = 0
    for v in conn.execute("SELECT id, name, dblp_key FROM venues WHERE dblp_key IS NULL"):
        guess = KNOWN_KEYS.get(v["id"])
        exact = False
        if guess and guess in streams:
            exact = True
        else:
            for prefix in ("conf", "journals"):
                key = f"{prefix}/{norm(v['name'])}"
                if key in streams:
                    guess = key
                    # the stream's own label must read as this venue
                    exact = norm(streams[key][0]).startswith(norm(v["name"]))
                    break
        if not guess or guess not in streams:
            continue
        if exact:
            conn.execute("UPDATE venues SET dblp_key = ? WHERE id = ?", (guess, v["id"]))
            applied += 1
        else:
            db.propose(conn, "venue", v["id"], "dblp_key", guess, f"https://dblp.org/db/{guess}/")
            proposed += 1
    unmapped = conn.execute("SELECT count(*) FROM venues WHERE dblp_key IS NULL").fetchone()[0]
    print(f"dblp keys: {applied} matched, {proposed} proposed for review, {unmapped} still unmapped")


# --------------------------------------------------------------------------
# 4. aggregate
# --------------------------------------------------------------------------
def main_tocs(rows: list[tuple], stream: str) -> dict[int, list[str]]:
    """Per year, the table(s) of contents that are the main proceedings.

    A DBLP stream mixes the main volume with co-located workshops, each in its
    own TOC (db/conf/sigcomm/sigcomm2024.html vs .../netai2024.html). The main
    one is named after the stream and the year, sometimes split into volumes
    (cvpr2024-1.html). Journals have one TOC per volume, so every TOC counts.
    """
    name = stream.split("/", 1)[1]
    by_year: dict[int, Counter] = defaultdict(Counter)
    for year, toc in rows:
        by_year[year][toc] += 1
    chosen = {}
    for year, tocs in by_year.items():
        if stream.startswith("journals/"):
            chosen[year] = list(tocs)
            continue
        main = [t for t in tocs if re.search(rf"/{re.escape(name)}{year}(-\d+)?\.html$", t)]
        chosen[year] = main or [tocs.most_common(1)[0][0]]
    return chosen


def ngrams(title: str) -> set[str]:
    words = [w.strip("-") for w in WORD.findall(title.lower())]
    words = [w for w in words if len(w) > 2 and not NOISE_TOKEN.match(w)]
    grams = set()
    for n in (1, 2, 3):
        for i in range(len(words) - n + 1):
            gram = words[i:i + n]
            if gram[0] in STOPWORDS or gram[-1] in STOPWORDS:
                continue
            grams.add(" ".join(gram))
    return grams


def aggregate(conn) -> None:
    papers = sqlite3.connect(PAPERS)
    this_year = date.today().year
    today = date.today().isoformat()
    venues = conn.execute("SELECT id, dblp_key FROM venues WHERE dblp_key IS NOT NULL").fetchall()

    # Keyword distinctiveness is measured against every tracked venue's
    # titles, so "neural" scores high at NeurIPS only if it is rarer elsewhere.
    doc_freq: Counter = Counter()
    total_docs = 0
    per_venue_year: dict[tuple, list[str]] = {}
    counted = frozen = 0
    by_toc = {toc: (title, ee) for toc, title, ee in papers.execute("SELECT toc, title, ee FROM volumes")}

    for v in venues:
        stream = v["dblp_key"]
        rows = papers.execute("SELECT year, toc, title FROM papers WHERE stream = ? AND year IS NOT NULL",
                              (stream,)).fetchall()
        tocs = main_tocs([(y, t) for y, t, _ in rows], stream)
        for year, keep in tocs.items():
            titles = [t for y, toc, t in rows if y == year and toc in keep and not NOT_A_PAPER.match(t)]
            if not titles:
                continue
            per_venue_year[(v["id"], year)] = titles
            for t in titles:
                doc_freq.update(ngrams(t))
            total_docs += len(titles)

            links = db.jdump([{
                "title": by_toc.get(toc, ("", ""))[0],
                "publisher": by_toc.get(toc, ("", ""))[1],
                "dblp": f"https://dblp.org/{toc}",
            } for toc in sorted(keep)])
            existing = conn.execute("SELECT status, links FROM proceedings WHERE venue_id = ? AND year = ?",
                                    (v["id"], year)).fetchone()
            if existing and existing["status"] == "verified":
                frozen += 1
                # verified counts are final; where-to-read links are filled in once
                if existing["links"] == "[]":
                    conn.execute("UPDATE proceedings SET links = ? WHERE venue_id = ? AND year = ?",
                                 (links, v["id"], year))
                continue
            done = year < this_year
            source = f"https://dblp.org/{keep[0]}" if len(keep) == 1 else f"https://dblp.org/db/{stream}/"
            conn.execute(
                "INSERT INTO proceedings (venue_id, year, accepted_count, source, status, verified_on, links) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (venue_id, year) DO UPDATE SET "
                "accepted_count = excluded.accepted_count, source = excluded.source, "
                "status = excluded.status, verified_on = excluded.verified_on, links = excluded.links",
                (v["id"], year, len(titles), source, "verified" if done else "unverified",
                 today if done else "", links))
            counted += 1

    # keywords: tf-idf over titles, recomputed for every year (cheap, local)
    conn.execute("DELETE FROM proceedings_keywords")
    rows = []
    for (venue_id, year), titles in per_venue_year.items():
        tf: Counter = Counter()
        for t in titles:
            tf.update(ngrams(t))
        scored = []
        size = len(titles)
        for gram, n in tf.items():
            if n < 2:
                continue
            # lift: how much more often this venue-year uses the phrase than
            # all tracked venues do. Frequency alone ranks "models" first
            # everywhere; lift alone ranks one-off phrases first. Their
            # product rewards phrases that are both common here and rarer
            # elsewhere.
            lift = (n / size) / ((doc_freq[gram] + 1) / total_docs)
            if lift <= 1.2:
                continue
            # a mild boost so "graph neural networks" beats "graph"
            scored.append((n * math.log(lift) * (1 + 0.25 * gram.count(" ")), gram, n))
        scored.sort(reverse=True)
        picked: list[tuple] = []
        for score, gram, n in scored:
            # skip a phrase wholly contained in one already picked with a similar count
            if any(gram in p[1] and p[2] >= n * 0.8 for p in picked):
                continue
            picked.append((score, gram, n))
            if len(picked) == TOP_KEYWORDS:
                break
        rows += [(venue_id, year, gram, n, round(score, 3)) for score, gram, n in picked]
    conn.executemany("INSERT INTO proceedings_keywords (venue_id, year, term, count, score) "
                     "VALUES (?, ?, ?, ?, ?)", rows)
    papers.close()

    trends = keyword_trends(conn, per_venue_year)
    print(f"proceedings: {counted} venue-years written, {frozen} verified and left alone; "
          f"{len(rows):,} keywords, {trends} trend rows")


def keyword_trends(conn, per_venue_year: dict) -> int:
    """Rising phrases across all venues, per year, from full title counts."""
    uses: dict[int, Counter] = defaultdict(Counter)      # year -> phrase -> titles
    where: dict[int, dict] = defaultdict(lambda: defaultdict(set))
    totals: Counter = Counter()
    for (venue_id, year), titles in per_venue_year.items():
        totals[year] += len(titles)
        for t in titles:
            for gram in ngrams(t):
                uses[year][gram] += 1
                where[year][gram].add(venue_id)

    conn.execute("DELETE FROM keyword_trends")
    last = date.today().year - 1
    rows = []
    for year in range(last - TRENDS_YEARS + 1, last + 1):
        prior = [y for y in (year - 3, year - 2, year - 1) if totals[y]]
        if not totals[year] or not prior:
            continue
        prior_total = sum(totals[y] for y in prior)
        scored = []
        for gram, n in uses[year].items():
            if n < 20 or len(where[year][gram]) < 2:
                continue
            before = sum(uses[y][gram] for y in prior)
            # shares, so a field that simply published more papers is not "trending"
            lift = (n / totals[year]) / ((before + 1) / prior_total)
            if lift < 1.5:
                continue
            scored.append((n * math.log(lift), gram, n, before / len(prior), len(where[year][gram]), lift))
        scored.sort(reverse=True)
        picked: list[tuple] = []
        for item in scored:
            if any(item[1] in p[1] for p in picked):
                continue
            picked.append(item)
            if len(picked) == TOP_TRENDS:
                break
        rows += [(year, gram, n, round(prev, 1), venues, round(lift, 2))
                 for _, gram, n, prev, venues, lift in picked]
    conn.executemany("INSERT INTO keyword_trends (year, term, count, prev_count, venues, lift) "
                     "VALUES (?, ?, ?, ?, ?, ?)", rows)
    return len(rows)


def plausible_streams(conn) -> set[str]:
    """Every stream a tracked venue could map to, so one parse serves mapping too."""
    out = set()
    for v in conn.execute("SELECT id, name, dblp_key FROM venues"):
        if v["dblp_key"]:
            out.add(v["dblp_key"])
            continue
        if v["id"] in KNOWN_KEYS:
            out.add(KNOWN_KEYS[v["id"]])
        out.update({f"conf/{norm(v['name'])}", f"journals/{norm(v['name'])}"})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-download", action="store_true")
    ap.add_argument("--map-only", action="store_true", help="propose dblp keys, do not count")
    args = ap.parse_args()

    if not args.skip_download:
        download()
    with db.session() as conn:
        wanted = plausible_streams(conn)
        if papers_current(wanted):
            print("cache/papers.sqlite is current for this dump, not re-parsing")
        else:
            parse(wanted)
        map_venues(conn)
        if args.map_only:
            return 0
        aggregate(conn)
        db.set_meta(conn, "proceedings_updated", datetime.now(timezone.utc).date().isoformat())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
