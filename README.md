# White Rabbit 🐇

> *"Oh dear! Oh dear! I shall be too late!"*

A small, self-updating dashboard that counts down to CFP deadlines across
systems, security, databases and software engineering. Static site, no backend
— GitHub Actions rebuilds it every night and publishes to GitHub Pages.

[![update & deploy](https://github.com/Kritshekhar/WhiteRabbit/actions/workflows/update-deadlines.yml/badge.svg)](https://github.com/Kritshekhar/WhiteRabbit/actions/workflows/update-deadlines.yml)
![venues](https://img.shields.io/badge/venues-37-blue)
![updates](https://img.shields.io/badge/updates-nightly-green)

**Live:** https://kritshekhar.github.io/WhiteRabbit/

---

## How it fits together

```
conferences.yml  ──►  scripts/update.py  ──►  data/deadlines.json  ──►  index.html
 (you edit this)      (nightly + on push)      (build output)          (the dashboard)
```

* **`conferences.yml`** is the only file you edit. One entry per venue.
* **`scripts/update.py`** normalises the config, rolls venues over to next
  year's site, checks that every link still resolves, and writes the JSON.
* **`data/deadlines.json`** is a build artifact — never edit it by hand.
* **`index.html` + `assets/`** render the dashboard. Countdowns are computed in
  the browser, so the day counts stay correct between nightly rebuilds.

## Adding a venue

Append to `venues:` in `conferences.yml`. The only required field is `name`:

```yaml
  - name: HotOS
    full_name: Workshop on Hot Topics in Operating Systems
    tier: tier1                                    # tier1 | companion | workshop
    url: https://sigops.org/s/conferences/hotos/2027/
    url_template: https://sigops.org/s/conferences/hotos/{year}/
    year: 2027
    deadlines:
      - name: Paper submission
        date: 2027-01-14T23:59:00-12:00            # -12:00 == AoE
        confirmed: true                            # drops the "est." badge
```

Push it — the workflow rebuilds and the card appears. Anything you leave out
gets a sensible default (missing tier → `companion`, missing date → **TBA**,
missing URL → the card renders without a link).

### Field reference

| Field | Meaning |
|---|---|
| `name` | **required** — the label on the card |
| `full_name` | spelled-out name, shown underneath |
| `tier` | `tier1` \| `companion` \| `workshop` (default `companion`) |
| `url` | homepage for the current cycle |
| `url_template` | URL pattern for auto-rollover. `{year}`→2027, `{yy}`→27, `{yyn}`→28. Omit to freeze the link. |
| `year` | which edition `url` points at |
| `month` | the month the conference is held (hint only) |
| `formats` | what the venue accepts, e.g. `[Full paper, Short paper, Poster]` — rendered as **Accepts** tags |
| `tracks` | e.g. `[Research, Industry]` — rendered as **Tracks** tags |
| `deadlines` | list of `{ name, date, confirmed, track }`; `date: null` renders as TBA |
| `deadlines[].track` | optional, e.g. `Research` / `Industry` — tagged beside that deadline, for venues whose tracks close on different days |
| `deadlines[].source` | the page the date was read off. **Required when `confirmed: true`** — the ✓ verified badge links to it |
| `deadlines[].verified_on` | when it was last checked against that page |
| `cycle_years` | years between editions (default 1). `2` for biennial venues like HotOS, so rollover steps 2025 → 2027 |
| `rolling` | `true` for journals — shows "Rolling submission", never counts down |
| `notes` | free text shown on the card |

## Link status

Every nightly build issues one HTTP request per venue URL, and the card footer
reports what came back:

| Badge | Meaning |
|---|---|
| **site up** | the URL responded 2xx/3xx — the page is there |
| **link broken** | 404/410 — the venue moved or removed the page, go find the new one |
| **not checked** | no answer either way: a timeout, or the host blocked the request. Also what you get after `--no-network` |

It checks that the *page exists*, nothing more. It says nothing about whether
the dates on that page are current — that is what `check_deadlines.py` is for.

## Automatic year rollover

When every deadline in a venue's cycle has passed (plus `grace_days`, default
21), the updater renders `url_template` for the next year and probes it. It
only moves when **both** hold:

1. the page answers 2xx/3xx, **and**
2. it looks like a real conference site — mentions the new year, is over 1 KB,
   and isn't a bare directory listing.

That second check earns its keep. Two ways a 200 lies, both hit in practice:

* **a stale edition served for any year** — `sigops.org/s/conferences/sosp/2099/`
  cheerfully returns the SOSP 2017 page
* **an empty autoindex** — `conferences.sigcomm.org/hotnets/2027/` is
  "Index of /hotnets/2027/", which even contains the year, in the directory path

Both slipped through earlier versions of this check and produced a wrong
rollover. When the check fails nothing is touched and it retries the next night.

On a successful rollover the script bumps `year`, rewrites `url`, shifts the
deadlines forward by `cycle_years` and sets `confirmed: false` — a shifted date is
an estimate until someone verifies it against the real CFP, and the dashboard
labels it `est.` until then.

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)**. Short version: edit
`conferences.yml`, nothing else. A date is either verified — `confirmed: true`
with a `source:` URL a reader can click — or it is estimated and wears an
**est.** badge. There is no third state, and CI enforces that a confirmed date
carries its source.

```bash
python scripts/validate_config.py      # structural checks, runs on every PR
python scripts/check_deadlines.py FSE  # what the venue's own page says
```

## Workflows

| Workflow | Trigger | Does |
|---|---|---|
| `validate.yml` | every PR | validates `conferences.yml`, proves an offline build works |
| `update-deadlines.yml` | nightly 07:00 UTC, push, manual | rebuilds the data, rolls venues over, commits back |
| `deploy-pages.yml` | push to `main`, manual | publishes to GitHub Pages |

Deploy is deliberately a separate workflow: publishing can be blocked by
account plan or Pages settings, and that must not make a healthy data refresh
look like a broken build.

## Publishing

Two one-time settings on <https://github.com/Kritshekhar/WhiteRabbit>:

1. **Settings → Pages → Source: GitHub Actions**
2. **Settings → Actions → General → Workflow permissions: Read and write**
   (the workflow commits the regenerated data file back to the repo)

The site then lands at <https://kritshekhar.github.io/WhiteRabbit/>.

The workflow (`.github/workflows/update-deadlines.yml`) runs at **07:00 UTC**
daily — midnight Arizona — on every push that touches the config or site, and
on demand via *Run workflow*.

## Local development

```bash
git clone git@github.com:Kritshekhar/WhiteRabbit.git && cd WhiteRabbit
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/update.py --no-network   # rebuild JSON, skip probes
python3 -m http.server 8000                       # then open localhost:8000
```

`--dry-run` prints what would change without writing anything.

## Verifying dates against the real CFP pages

```bash
.venv/bin/python scripts/check_deadlines.py             # all venues
.venv/bin/python scripts/check_deadlines.py eurosys sc  # substring filter
.venv/bin/python scripts/check_deadlines.py --unconfirmed
```

It prints, per venue, what the config claims next to every deadline-looking
line it can pull off the venue's site (landing page, then the usual
`/cfp`, `/dates`, `/important-dates` paths):

```
### EuroSys  (2027)
    source: https://2027.eurosys.org/cfp
    config: Fall round: 2026-10-16T23:59:00-12:00  <- unconfirmed
    site:   Paper titles and abstracts due: Thursday, September 17, 2026
    site:   Full paper submissions due: Thursday, September 24, 2026
```

It deliberately **does not** write to `conferences.yml`. CFP pages are
unstructured prose, every venue words things differently, and plenty of them
still have last year's dates sitting in the HTML — auto-parsing that into the
config would quietly produce wrong deadlines, which is the one thing a
deadline tracker must not do. You read the output, fix the config, and set
`confirmed: true`.

Ten venues were verified this way on 2026-08-26 (FAST, OSDI, EuroSys, ASPLOS,
NSDI, SIGMETRICS, USENIX Security, IMC, SoCC, HotStorage). The rest are still
extrapolated from previous cycles and carry an **est.** badge — a few of those
sites are JavaScript-rendered (researchr.org) or have no CFP up yet, so they
need a human look.
