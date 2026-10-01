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
    "ipdps": "conf/ipps",
    "ase": "conf/kbse",
    "msst": "conf/mss",
    "imc": "conf/imc",
    "rss": "conf/rss",
    "ijcb": "conf/icb",
    "sigkdd": "conf/kdd",            # not journals/sigkdd, the Explorations newsletter
    "acm-mm": "conf/mm",
    "ieee-vr": "conf/vr",
    "ieee-acm-cgo": "conf/cgo",
    "socg": "conf/compgeom",
    "icsme": "conf/icsm",
    "icpc": "conf/iwpc",
    "mobilehci": "conf/mhci",
    "ecml-pkdd": "conf/pkdd",
    "icme": "conf/icmcs",
    "icmr": "conf/mir",
    "3dv": "conf/3dim",
    "ccc": "conf/coco",
    "csfw": "conf/csfw",
    "fc": "conf/fc",
    "pkc": "conf/pkc",
    "hscc": "conf/hybrid",
    "lctes": "conf/lctrts",
    "cf": "conf/cf",
    "ats": "conf/ats",
    "sca": "conf/sca",
    "glsvlsi": "conf/glvlsi",
    "ieee-cog": "conf/cig",
    "collaboratecom": "conf/colcom",
    "apweb-waim": "conf/apweb",
    "sigspatial": "conf/gis",
    "isc": "conf/isw",
    "cgi": "conf/cgi",
    "smi": "conf/smi",
    "inscrypt": "conf/cisc",
}

# Venues whose papers DBLP files in a journal, by issue. Each rule is a
# stream, the issues it takes (DBLP's <number>; None for every issue) and the
# publication years it covers. Checked against DBLP's issue sizes and titles:
# SIGGRAPH is TOG issue 4; POPL, OOPSLA, ICFP and (since 2023) PLDI are PACMPL
# issues of those names; since 2008 CGF issue 2 is Eurographics, 3 EuroVis,
# 4 EGSR, 5 SGP and 7 Pacific Graphics; IEEE VIS moved between TVCG issues.
# Before a venue moved, its conference stream's main volume counts as usual.
def _r(stream, numbers=None, start=None, end=None):
    return {"stream": stream, "numbers": numbers, "from": start, "until": end}


JOURNAL_VENUES: dict[str, list[dict]] = {
    "acm-siggraph": [_r("conf/siggraph", end=2001), _r("journals/tog", ["4"], 2002)],
    "popl": [_r("conf/popl", end=2017), _r("journals/pacmpl", ["POPL"], 2018)],
    "oopsla": [_r("conf/oopsla", end=2016), _r("journals/pacmpl", ["OOPSLA", "OOPSLA1", "OOPSLA2"], 2017)],
    "icfp": [_r("conf/icfp", end=2016), _r("journals/pacmpl", ["ICFP"], 2017)],
    "pldi": [_r("conf/pldi", end=2022), _r("journals/pacmpl", ["PLDI"], 2023)],
    "ubicomp-iswc": [_r("conf/huc", end=2016), _r("journals/imwut", None, 2017)],
    "pets": [_r("conf/pet", end=2014), _r("journals/popets", None, 2015)],
    "ieee-vis": [_r("journals/tvcg", ["5"], 2006, 2006), _r("journals/tvcg", ["6"], 2007, 2010),
                 _r("journals/tvcg", ["12"], 2011, 2014), _r("journals/tvcg", ["1"], 2016, 2020),
                 _r("journals/tvcg", ["2"], 2021, 2021), _r("journals/tvcg", ["1"], 2022)],
    "eurographics": [_r("journals/cgf", ["2", "2pt1", "2pt2", "2pt3", "2pt4"], 2008)],
    "eurovis": [_r("journals/cgf", ["3"], 2008)],
    "egsr": [_r("journals/cgf", ["4"], 2008)],
    "sgp": [_r("conf/sgp", end=2007), _r("journals/cgf", ["5"], 2008)],
    "pg": [_r("journals/cgf", ["7"], 2008)],
}


def journal_rows(papers, venue_id: str) -> tuple[list[tuple], dict[int, list[str]]]:
    """(year, toc, title, authors) for a journal-published venue, and per year
    the tables of contents they came from. Conference-era years use the main
    proceedings volume, exactly as for any other venue."""
    rows: list[tuple] = []
    tocs: dict[int, list[str]] = defaultdict(list)
    for rule in JOURNAL_VENUES[venue_id]:
        found = papers.execute(
            "SELECT year, toc, title, authors, number FROM papers WHERE stream = ? AND year IS NOT NULL",
            (rule["stream"],)).fetchall()
        found = [r for r in found
                 if (rule["from"] is None or r[0] >= rule["from"]) and (rule["until"] is None or r[0] <= rule["until"])
                 and (rule["numbers"] is None or r[4] in rule["numbers"])]
        if rule["stream"].startswith("conf/"):
            keep = main_tocs([(y, t) for y, t, *_ in found], rule["stream"])
            found = [r for r in found if r[1] in keep.get(r[0], [])]
        for y, t, title, authors, _ in found:
            rows.append((y, t, title, authors))
            if t not in tocs[y]:
                tocs[y].append(t)
    return rows, dict(tocs)


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
when what how why which where all any one two three high low system systems big
only introduction special chinese english brief traditional work-in-progress
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
                             title TEXT, doi TEXT, booktitle TEXT, authors TEXT, number TEXT);
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
            state["rec"] = {"key": attrs.get("key", ""), "ee": [], "author": []}
        elif state["rec"] is not None and name in ("title", "year", "booktitle", "journal", "url", "ee", "author", "number"):
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
            if name in ("ee", "author"):
                rec[name].append(text)
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
            batch.append((rec["key"], stream, year, toc, rec.get("title", ""), doi.lower(), label,
                          "\n".join(rec["author"]), rec.get("number", "")))
            if len(batch) >= 5000:
                out.executemany("INSERT OR REPLACE INTO papers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", batch)
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
        out.executemany("INSERT OR REPLACE INTO papers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", batch)
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
        con.execute("SELECT authors, number FROM papers LIMIT 1")  # ...or before authors and issues?
        con.close()
    except sqlite3.Error:
        return False
    return had == streams


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def map_venues(conn) -> None:
    # venues that publish in a journal are mapped by their rules, not by name
    for venue_id, rules in JOURNAL_VENUES.items():
        conn.execute("UPDATE venues SET dblp_key = ? WHERE id = ? AND (dblp_key IS NULL OR dblp_key <> ?)",
                     (rules[-1]["stream"], venue_id, rules[-1]["stream"]))
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
            conn.execute("DELETE FROM candidates WHERE entity = 'venue' AND entity_id = ? AND field = 'dblp_key'",
                         (v["id"],))
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
    authors_of: dict[tuple, list[list[str]]] = {}
    counted = frozen = 0
    by_toc = {toc: (title, ee) for toc, title, ee in papers.execute("SELECT toc, title, ee FROM volumes")}

    for v in venues:
        stream = v["dblp_key"]
        if v["id"] in JOURNAL_VENUES:
            rows, tocs = journal_rows(papers, v["id"])
        else:
            rows = papers.execute("SELECT year, toc, title, authors FROM papers WHERE stream = ? AND year IS NOT NULL",
                                  (stream,)).fetchall()
            tocs = main_tocs([(y, t) for y, t, _, _ in rows], stream)
        for year, keep in tocs.items():
            kept = [(t, a) for y, toc, t, a in rows if y == year and toc in keep and not NOT_A_PAPER.match(t)]
            titles = [t for t, _ in kept]
            authors_of[(v["id"], year)] = [a.split("\n") if a else [] for _, a in kept]
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
    insights(conn, per_venue_year, authors_of)
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


# --------------------------------------------------------------------------
# 5. insights: rise and fall, spread, similar venues, authors
# --------------------------------------------------------------------------
SINCE = 2000              # term_venue_year starts here
RISING_PER_YEAR = 6       # top rising phrases kept from each recent year
FADING = 40               # phrases that peaked and faded
SIMILAR = 5               # matches kept per venue
TOP_AUTHORS = 10
# Ideas always tracked, so the spread view covers systems, security and
# databases too, not only whatever topped the ML-heavy trend lists.
NOTABLE = [
    "llm", "llms", "large language models", "transformer", "diffusion", "federated learning",
    "reinforcement learning", "graph neural networks", "deep learning", "adversarial",
    "differential privacy", "fairness", "explainable", "quantum", "blockchain", "serverless",
    "rdma", "persistent memory", "kubernetes", "edge computing", "cloud computing", "mapreduce",
    "gpu", "fpga", "smart contracts", "fuzzing", "side-channel", "zero-knowledge",
    "neural radiance", "gaussian splatting", "autonomous driving", "big data", "crowdsourcing",
]
NEWCOMER_WARMUP = 3       # a venue's first years have no history to be new to
ERAS_FROM = 2008          # first year on the research eras timeline
ERAS_PER_YEAR = 3


def research_eras(conn, grams_of: dict, uses: dict, totals: Counter, years: list, last: int) -> list[str]:
    """Each year's breakout ideas, each idea once. Returns the phrases chosen."""
    venues_using: dict[int, Counter] = defaultdict(Counter)
    for (venue_id, year), sets in grams_of.items():
        seen: set = set()
        for g in sets:
            seen |= g
        venues_using[year].update(seen)

    def share(term, y):
        return uses[y][term] / totals[y] if totals[y] else 0.0

    def generic(term):
        # a single word in more than 2% of all titles is vocabulary, not an idea
        return " " not in term and term not in NOTABLE and max(share(term, y) for y in years) > 0.02

    def related(a, b):
        a, b = a.replace("-", ""), b.replace("-", "")   # multi-core is multicore
        if a in b or b in a or a + "s" == b or b + "s" == a:
            return True
        # the same idea named from the other end: "generative adversarial" and
        # "adversarial networks" share the distinctive word
        shared = set(a.split()) & set(b.split())
        return any(w not in ("networks", "network", "learning", "neural", "graph", "deep", "models") for w in shared)

    featured: list[str] = []
    rows = []
    for year in range(ERAS_FROM, last + 1):
        prior = [y for y in (year - 3, year - 2, year - 1) if totals[y]]
        if not totals[year] or not prior:
            continue
        prior_total = sum(totals[y] for y in prior)
        scored = []
        for term, n in uses[year].items():
            if n < 30 or venues_using[year][term] < 3 or generic(term):
                continue
            before = sum(uses[y][term] for y in prior)
            lift = (n / totals[year]) / ((before + 1) / prior_total)
            if lift < 1.6:
                continue
            # growth counts twice: a phrase that jumped ×29 is more of a breakout
            # than a common one that grew ×2.5, even with fewer papers
            scored.append((n * math.log(lift) ** 2 * (1 + 0.3 * term.count(" ")), term, n, before / len(prior), lift))
        scored.sort(reverse=True)
        # a word gives way to its phrase when the phrase carries most of it
        terms = {t for _, t, *_ in scored}
        picked = []
        for item in scored:
            term, n = item[1], item[2]
            if " " not in term and any(term in p.split() and uses[year][p] >= 0.5 * n for p in terms if p != term):
                continue
            if any(related(term, f) for f in featured) or any(related(term, p[1]) for p in picked):
                continue
            # two phrases for the same idea in one year ("generative adversarial",
            # "adversarial networks"): keep the first
            if any(set(term.split()) & set(p[1].split()) for p in picked):
                continue
            picked.append(item)
            if len(picked) == ERAS_PER_YEAR:
                break
        for rank, (_, term, n, prev, lift) in enumerate(picked, 1):
            rows.append((year, rank, term, n, round(prev, 1), round(lift, 2), venues_using[year][term]))
            featured.append(term)
    conn.execute("DELETE FROM research_eras")
    conn.executemany("INSERT INTO research_eras (year, rank, term, count, prev_count, lift, venues) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
    return featured


def insights(conn, per_venue_year: dict, authors_of: dict) -> None:
    last = date.today().year - 1
    grams_of: dict[tuple, list[set]] = {
        key: [ngrams(t) for t in titles] for key, titles in per_venue_year.items() if key[1] >= SINCE}

    # field-wide phrase shares per year
    uses: dict[int, Counter] = defaultdict(Counter)
    totals: Counter = Counter()
    for (venue_id, year), sets in grams_of.items():
        totals[year] += len(sets)
        for g in sets:
            uses[year].update(g)

    # --- which phrases to track
    years = [y for y in range(2005, last + 1) if totals[y]]

    def share(term, y):
        return uses[y][term] / totals[y] if totals[y] else 0.0

    def plural_twin(term, picked):
        return any(term == p + "s" or p == term + "s" for p in picked)

    rising: list[str] = []
    for (term,) in conn.execute(
            "SELECT term FROM (SELECT term, year, row_number() OVER (PARTITION BY year ORDER BY count * ln(lift) DESC) AS r "
            "FROM keyword_trends) WHERE r <= ? GROUP BY term ORDER BY min(year)", (RISING_PER_YEAR,)):
        # a single word in more than 2% of all titles is vocabulary, not an idea
        common = " " not in term and term not in NOTABLE and max(share(term, y) for y in years) > 0.02
        if not common and not plural_twin(term, rising):
            rising.append(term)

    eras = research_eras(conn, grams_of, uses, totals, years, last)

    # Fading: a hype cycle, not a common word in slow decline. The phrase must
    # have at least tripled its share in the six years before its peak, peaked
    # at least four years ago, and be under 40% of that peak now.
    fading = []
    candidates = Counter()
    for y in years:
        candidates.update({t: n for t, n in uses[y].items() if n >= 40})
    for term in candidates:
        if term in rising:
            continue
        series = [(share(term, y), y) for y in years]
        peak_share, peak_year = max(series)
        if " " not in term and peak_share > 0.02:
            continue
        before = share(term, peak_year - 6) if peak_year - 6 >= SINCE else 0.0
        now = share(term, last)
        if (2008 <= peak_year <= last - 4 and uses[peak_year][term] >= 40
                and peak_share >= 3 * max(before, 1e-9) and now <= 0.4 * peak_share):
            fading.append((uses[peak_year][term] * math.log(peak_share / max(now, 1e-4)), term, peak_year, peak_share, now))
    # a word that is only ever half of a fading phrase ("particle" in "particle
    # swarm") is left to the phrase
    phrases = {t: n for _, t, py, _, _ in fading if " " in t for n in [uses[py][t]]}
    fading = [f for f in fading if " " in f[1] or not any(
        f[1] in p.split() and n >= 0.6 * uses[f[2]][f[1]] for p, n in phrases.items())]
    fading.sort(reverse=True)
    picked_fading: list[tuple] = []
    for item in fading:
        if any(item[1] in p[1] or p[1] in item[1] for p in picked_fading) or plural_twin(item[1], [p[1] for p in picked_fading]):
            continue
        picked_fading.append(item)
        if len(picked_fading) == FADING:
            break

    conn.execute("DELETE FROM tracked_terms")
    tracked = {}
    for term in rising:
        series = [(share(term, y), y) for y in years]
        peak_share, peak_year = max(series) if series else (0.0, last)
        tracked[term] = ("rising", peak_year, peak_share, share(term, last))
    for _, term, peak_year, peak_share, now in picked_fading:
        tracked[term] = ("fading", peak_year, peak_share, now)
    # era phrases get a share series too, for the timeline's trend lines
    for term in eras:
        if term in tracked or not any(uses[y][term] for y in years):
            continue
        peak_share, peak_year = max((share(term, y), y) for y in years)
        now = share(term, last)
        kind = "fading" if peak_year <= last - 4 and now <= 0.4 * peak_share else "rising"
        tracked[term] = (kind, peak_year, peak_share, now)
    for term in NOTABLE:
        if term in tracked or plural_twin(term, tracked) or not any(uses[y][term] for y in years):
            continue
        peak_share, peak_year = max((share(term, y), y) for y in years)
        now = share(term, last)
        kind = "fading" if peak_year <= last - 4 and now <= 0.4 * peak_share else "rising"
        tracked[term] = (kind, peak_year, peak_share, now)
    conn.executemany("INSERT INTO tracked_terms (term, kind, peak_year, peak_share, now_share) VALUES (?, ?, ?, ?, ?)",
                     [(t, k, py, round(ps, 5), round(ns, 5)) for t, (k, py, ps, ns) in tracked.items()])

    # --- where each tracked phrase appears
    conn.execute("DELETE FROM term_venue_year")
    rows = []
    for (venue_id, year), sets in grams_of.items():
        counts = Counter()
        for g in sets:
            for term in g & tracked.keys():
                counts[term] += 1
        rows += [(t, venue_id, year, n) for t, n in counts.items()]
    conn.executemany("INSERT INTO term_venue_year (term, venue_id, year, count) VALUES (?, ?, ?, ?)", rows)

    # --- similar venues: tf-idf over the last five complete years of titles
    recent: dict[str, Counter] = defaultdict(Counter)
    for (venue_id, year), sets in grams_of.items():
        if last - 4 <= year <= last:
            for g in sets:
                recent[venue_id].update(g)
    df = Counter()
    for c in recent.values():
        df.update(c.keys())
    n_venues = len(recent)
    vectors = {}
    for venue_id, c in recent.items():
        if sum(c.values()) < 50:
            continue
        vec = {t: n * math.log(n_venues / df[t]) for t, n in c.items() if n >= 2 and df[t] < n_venues}
        norm_ = math.sqrt(sum(x * x for x in vec.values())) or 1.0
        vectors[venue_id] = {t: x / norm_ for t, x in vec.items()}
    conn.execute("DELETE FROM venue_similarity")
    sim_rows = []
    for a, va in vectors.items():
        scores = []
        for b, vb in vectors.items():
            if a == b:
                continue
            small, big = (va, vb) if len(va) < len(vb) else (vb, va)
            dot = sum(x * big.get(t, 0.0) for t, x in small.items())
            if dot > 0:
                scores.append((dot, b))
        for dot, b in sorted(scores, reverse=True)[:SIMILAR]:
            shared = sorted(va.keys() & vectors[b].keys(), key=lambda t: -min(va[t], vectors[b][t]))[:6]
            sim_rows.append((a, b, round(dot, 4), db.jdump(shared)))
    conn.executemany("INSERT INTO venue_similarity (venue_id, other_id, score, shared) VALUES (?, ?, ?, ?)", sim_rows)

    # --- authors
    conn.execute("DELETE FROM proceedings_authors")
    conn.execute("DELETE FROM top_authors")
    by_venue: dict[str, list[int]] = defaultdict(list)
    for venue_id, year in authors_of:
        by_venue[venue_id].append(year)
    overall = Counter()
    span: dict[str, list[int]] = {}
    author_rows, top_rows = [], []
    for venue_id, ys in by_venue.items():
        ys.sort()
        seen: set[str] = set()
        mine = Counter()
        first_years: dict[str, list[int]] = {}
        for i, year in enumerate(ys):
            papers_ = [a for a in authors_of[(venue_id, year)] if a]
            if not papers_:
                continue
            # a paper none of whose authors had published at this venue before
            newcomer = sum(1 for a in papers_ if all(x not in seen for x in a)) / len(papers_)
            people = {x for a in papers_ for x in a}
            author_rows.append((venue_id, year, round(sum(map(len, papers_)) / len(papers_), 3),
                                round(sum(1 for a in papers_ if len(a) == 1) / len(papers_), 4),
                                round(newcomer, 4) if i >= NEWCOMER_WARMUP else None, len(people)))
            for a in papers_:
                for x in a:
                    mine[x] += 1
                    overall[x] += 1
                    first_years.setdefault(x, [year, year])[1] = year
                    sp = span.setdefault(x, [year, year])
                    sp[0], sp[1] = min(sp[0], year), max(sp[1], year)
            seen |= people
        for rank, (name, n) in enumerate(mine.most_common(TOP_AUTHORS), 1):
            top_rows.append((venue_id, rank, name, n, first_years[name][0], first_years[name][1]))
    for rank, (name, n) in enumerate(overall.most_common(20), 1):
        top_rows.append(("all", rank, name, n, span[name][0], span[name][1]))
    conn.executemany("INSERT INTO proceedings_authors (venue_id, year, mean_authors, solo_share, newcomer_share, authors) "
                     "VALUES (?, ?, ?, ?, ?, ?)", author_rows)
    conn.executemany("INSERT INTO top_authors (scope, rank, name, papers, first_year, last_year) VALUES (?, ?, ?, ?, ?, ?)",
                     top_rows)
    print(f"insights: {len(tracked)} tracked phrases ({len(picked_fading)} fading), {len(rows):,} spread rows, "
          f"{len(sim_rows)} similar-venue pairs, {len(author_rows):,} author rows")


def plausible_streams(conn) -> set[str]:
    """Every stream a tracked venue could map to, so one parse serves mapping too."""
    out = {rule["stream"] for rules in JOURNAL_VENUES.values() for rule in rules}
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
    ap.add_argument("--recompute", default="",
                    help="comma-separated venue ids whose statistics were computed from a wrong mapping: "
                         "their rows, verified ones included, are cleared and computed afresh")
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
        for venue_id in filter(None, (x.strip() for x in args.recompute.split(","))):
            for table in ("proceedings", "proceedings_keywords", "proceedings_topics", "proceedings_authors"):
                conn.execute(f"DELETE FROM {table} WHERE venue_id = ?", (venue_id,))
            conn.execute("DELETE FROM top_authors WHERE scope = ?", (venue_id,))
            print(f"recomputing {venue_id} from scratch")
        aggregate(conn)
        db.set_meta(conn, "proceedings_updated", datetime.now(timezone.utc).date().isoformat())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
