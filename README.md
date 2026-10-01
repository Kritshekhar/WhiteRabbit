<h1 align="center">White Rabbit 🐇</h1>

<p align="center">
  <em>"Oh dear! Oh dear! I shall be too late!"</em><br>
  A self-updating tracker for conference paper deadlines.
</p>

<p align="center">
  <a href="https://kritshekhar.github.io/WhiteRabbit/"><b>Live dashboard</b></a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/Kritshekhar/WhiteRabbit/actions/workflows/update-deadlines.yml"><img alt="refresh" src="https://github.com/Kritshekhar/WhiteRabbit/actions/workflows/update-deadlines.yml/badge.svg"></a>
  <a href="https://github.com/Kritshekhar/WhiteRabbit/actions/workflows/validate.yml"><img alt="validate" src="https://github.com/Kritshekhar/WhiteRabbit/actions/workflows/validate.yml/badge.svg"></a>
</p>

![The White Rabbit dashboard](docs/screenshot.png)

---

A static site with no backend. The data lives in a SQLite database whose text
dump is committed to this repo; GitHub Actions refreshes it every night and
publishes an [Astro](https://astro.build) site to GitHub Pages. Countdowns are
computed in your browser, so the numbers are right even between builds.

| | |
|---|---|
| **Home** | the next deadlines across conferences and funding, and a search box |
| **Conferences** | 99 conference, workshop and journal deadlines |
| **Grants** | federal and industry grant calls for faculty and PIs |
| **Fellowships** | fellowships open to PhD students |
| **Proceedings** | papers per year over each venue's full history, the keywords it publishes most, and what is trending |
| **About** | what the stage names mean |

What makes it different from a spreadsheet of dates:

- **Every date says whether it was checked.** A ✓ **verified** badge links to the
  page it was read off. An **est.** badge means extrapolated or imported and not
  yet confirmed. There is no third state, and the database refuses a verified
  row without a source.
- **Verified data is final.** Once a row is verified it is never crawled again;
  the crawlers only revisit the `needs_check` queue of unverified rows.
- **Links roll over on their own.** Once a cycle closes, the venue moves to next
  year's site as soon as that site is genuinely live, and the old cycle is kept.
- **It tracks a project's path, not a league table.** Workshop → full paper →
  journal, with grades only where they matter. See **[About](https://kritshekhar.github.io/WhiteRabbit/about/)**.
- **Every deadline is one click from your calendar.** The Google Calendar link
  is an absolute UTC instant rather than an all-day event, because an all-day
  event lands on the viewer's local day and would silently move an AoE deadline.

## Editing the data

`scripts/wr.py` is the editor. Every command writes through to
`db/whiterabbit.sql`, so a change is an ordinary diff in a pull request.

```bash
python scripts/wr.py add-venue HotOS --full-name "Workshop on Hot Topics in Operating Systems" \
    --tier rabbit-hole --url https://sigops.org/s/conferences/hotos/2027/ \
    --url-template "https://sigops.org/s/conferences/hotos/{year}/" --year 2027 --topic Systems
python scripts/wr.py set hotos cycle_years 2                      # biennial
python scripts/wr.py add-deadline hotos "Paper submission" 2027-01-14T23:59:00-12:00
python scripts/wr.py verify hotos --source https://sigops.org/s/conferences/hotos/2027/cfp.html
python scripts/wr.py show hotos
python scripts/wr.py queue                                        # what still needs verifying
```

`verify` is the only way a row becomes verified, and it needs `--source`: the
first-party page you read the date on. Dates are ISO 8601; use `-12:00` for AoE.
A bare date is read as AoE end of day. Any edit that breaks a rule is refused
and nothing is saved. Full guide in **[CONTRIBUTING.md](CONTRIBUTING.md)**.

<details>
<summary><b>Venue fields</b></summary>

| Field | Meaning |
|---|---|
| `name` | **required** - the label on the row |
| `full_name` | spelled-out name, shown underneath |
| `tier` | `rabbit-hole` \| `royal-flush` \| `full-house` \| `looking-glass` - stage on the journey (default `full-house`) |
| `url` | homepage for the current cycle |
| `url_template` | pattern for auto-rollover: `{year}`→2027, `{yy}`→27, `{yyn}`→28. Empty freezes the link. |
| `year` | which edition `url` points at |
| `month` | month the conference is held (sorting hint) |
| `cycle_years` | years between editions (default 1; `2` for biennial venues) |
| `rolling` | `1` for journals - shows "Rolling submission", never counts down |
| `formats`, `tracks`, `topics` | comma-separated with `wr.py set`, e.g. `"Full paper, Poster"` |
| `notes` | free text shown on the page |
| `dblp_key` | the venue's DBLP stream, e.g. `conf/fast`, for proceedings stats |

</details>

## How it works

```
db/whiterabbit.sql ──► scripts/db.py build ──► db/whiterabbit.sqlite ──► web/ (Astro) ──► GitHub Pages
  committed dump          (gitignored)              ▲
                                                    │
        update.py · import_*.py · verify_grants.py · proceedings_*.py · wr.py
```

`db/schema.sql` defines the tables. The `.sqlite` file is a build artefact,
rebuilt automatically whenever the dump or schema changes. The dump is
deterministic, one row per line in key order, so every change reviews as a
normal diff.

The database holds ISO dates and **no day counts**. The site recomputes days,
urgency colours and sort order from the browser's clock on every page load, so
a venue can go un-probed for weeks and its countdown is still correct.

Fetching is only about link health, year rollover and confirming unverified
dates. A nightly run re-checks what plausibly moved: venues with unverified
dates, venues whose last check failed, venues with a rollover pending, and
anything last checked over 30 days ago. Verifying a date also makes the build
cheaper, since a verified row drops out of the queue for good.

### Year rollover

When every deadline in a cycle has passed, the updater renders `url_template` for
the next year and moves only if that page answers 2xx/3xx **and** looks real:
it mentions the new year, exceeds 1 KB, and is not a bare directory listing.
After probing, a venue that rolled onto a link that is not `ok` is put back.

Those checks are not paranoia. `sigops.org/…/sosp/2099/` returns the SOSP 2017
page, `conferences.sigcomm.org/hotnets/2027/` is an empty autoindex whose title
contains "2027", and one host answered `200` to GitHub's runners and `404` to us
minutes later. Each one produced a wrong rollover before the check existed.

On success the venue's `year` and `url` move on, and next cycle's deadlines are
added as new, unverified rows shifted by the cycle length. The finished cycle's
rows stay in the database as history.

### Proceedings statistics

`scripts/proceedings_dblp.py` downloads the [DBLP](https://dblp.org) XML dump
(1.1 GB, monthly, kept in the Actions cache and never in git), streams it once,
and counts each tracked venue's papers per year in its main proceedings volume,
over its full history. It also extracts the title phrases most distinctive of
each venue-year, and the phrases rising across all venues. A finished year's
count is verified with its DBLP table of contents as the source and never
recomputed; the current year stays unverified while its volume fills in.

These are **papers in the main DBLP volume**, not official acceptance counts:
some venues publish short papers in the same volume, and DBLP excludes nothing
the venue printed. Workshop volumes, front matter and keynotes are left out.

`scripts/proceedings_openalex.py` adds a topic breakdown per venue-year from
[OpenAlex](https://openalex.org), using the DOIs DBLP lists. OpenAlex allows
1,000 keyless requests a day, so this backfills a little every day and resumes
where it stopped; set `OPENALEX_API_KEY` to go faster. Venues DBLP cannot match
by name are proposed in the `candidates` queue (`wr.py queue`) for a person to
confirm with `wr.py set <venue> dblp_key <key>`.

## Tools

```bash
python scripts/db.py check                   # validate the data; runs on every PR
python scripts/import_ccf.py AI --dry-run    # import more venues
python scripts/import_grants.py --dry-run    # import new federal CS grants
python scripts/enrich_grants.py              # solicitation text and funding figures
python scripts/verify_grants.py --dry-run    # confirm federal dates at source
python scripts/check_deadlines.py eurosys    # what the venue's own page says
python scripts/check_deadlines.py --formats  # page limits and track names
python scripts/update.py --scope all         # refresh, re-probing everything
python scripts/proceedings_dblp.py           # proceedings counts and keywords
python scripts/proceedings_openalex.py       # topic backfill
```

`check_deadlines.py` prints the database's claim next to every deadline-looking
line on the venue's site:

```
### EuroSys  (2027)
    source: https://2027.eurosys.org/cfp
    config: Fall round: 2026-10-16T23:59:00-12:00  <- unconfirmed
    site:   Paper titles and abstracts due: Thursday, September 17, 2026
    site:   Full paper submissions due: Thursday, September 24, 2026
```

It **never writes to the database**, and that is deliberate. CFP pages are
prose, and plenty of them serve last year's dates from this year's URL - NDSS's
2027 page still shows 2024 dates. Auto-parsing that would quietly produce wrong
deadlines, which is the one thing a deadline tracker must not do. The tool
proposes; a person decides with `wr.py verify`.

Add `--firecrawl` for pages plain fetching cannot read (JS-rendered, bot-blocked,
prose-buried). It works without an API key; `FIRECRAWL_API_KEY` raises the rate
limit and unlocks CFP-page discovery. It runs last, only after the free paths fail.

## Local development

```bash
git clone https://github.com/Kritshekhar/WhiteRabbit.git && cd WhiteRabbit
python3 scripts/db.py build                  # db/whiterabbit.sqlite from the dump
cd web && npm install && npm run dev         # http://localhost:4321/WhiteRabbit/
```

Only the importers need a package (`pip install -r requirements.txt`); the
database tools use the standard library.

## Workflows

| Workflow | Trigger | Does |
|---|---|---|
| `validate.yml` | every PR | `db.py check`, proves the dump is canonical and an offline build works |
| `update-deadlines.yml` | nightly 07:00 UTC · monthly full sweep · push | probes links, rolls venues over, commits the dump |
| `weekly-funding-sweep.yml` | Mondays 09:00 UTC | imports, enriches and verifies federal grant calls, opens a PR |
| `propose-deadlines.yml` | Mondays 08:00 UTC | sweeps CFP pages for unverified venues, opens an issue - never edits the data |
| `proceedings-stats.yml` | daily 05:00 UTC | DBLP counts and keywords, OpenAlex topic backfill, commits the dump |
| `deploy-pages.yml` | push to `main` | builds the database and the Astro site, publishes to GitHub Pages |

Deploy is a separate workflow on purpose: publishing can be blocked by Pages
settings, and that should not make a healthy data refresh look like a broken build.

## Running your own

Fork it, replace the venues with the ones for your field (`wr.py add-venue`, or
edit `db/whiterabbit.sql` and run `db.py check`), then enable
**Settings → Pages → Source: GitHub Actions** and
**Settings → Actions → Workflow permissions: Read and write** (the scheduled
jobs commit the refreshed dump back).

## Where the data comes from

| Source | What | How |
|---|---|---|
| hand-maintained | the original venue list, all 13 fellowships | `wr.py` |
| [DBLP](https://dblp.org) XML dump (CC0) | papers per venue per year, title keywords | `proceedings_dblp.py` |
| [OpenAlex](https://openalex.org) (CC0) | research topics per venue-year | `proceedings_openalex.py` |

Two sources were assessed and rejected: `paperswithcode/ai-deadlines`, which
has not been updated since September 2024 and has no future deadlines, and
NSF's own funding pages, which return 202 to scripts and whose RSS feed is dead.
DBLP's search API was also ruled out: it now sits behind a bot challenge, and
the dump is the better tool for full history anyway.

## A note on the dates

Every date here is community-maintained and some are extrapolated. The **est.**
badge is honest, not decorative - **always confirm on the venue's own CFP page
before you plan around it.** If you spot a wrong date,
[open an issue](https://github.com/Kritshekhar/WhiteRabbit/issues/new/choose);
it takes one line to fix.

## License

MIT - see [LICENSE](LICENSE).
