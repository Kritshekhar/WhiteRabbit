# Contributing

Almost every useful contribution is a one-file edit to **`conferences.yml`**.
You do not need to run anything locally to help.

## The one rule

**A date is either verified or it is estimated, and the file must say which.**

```yaml
      - name: Paper submission
        date: 2026-09-15T23:59:00-12:00
        confirmed: true
        source: https://www.usenix.org/conference/fast27   # required when confirmed
        verified_on: 2026-08-26
```

`confirmed: true` means *you personally read this date on that page*. It earns
a **✓ verified** badge that links to `source`, so any reader can re-check it.
`confirmed: false` renders **est.** — an honest "we guessed from last year".

Never flip `confirmed` to `true` because the date looks right. Several venues
serve stale calls: NDSS's 2027 page showed 2024 dates, SIGCOMM's 2027 site
still carries the 2026 call. If the page does not state the date for *this*
edition, leave it estimated.

## Add a venue

Append to `venues:`. Only `name` is required; everything else has a default.

```yaml
  - name: SOSP
    full_name: ACM Symposium on Operating Systems Principles
    tier: royal-flush                 # royal-flush | full-house | high-card | wild-card
    url: https://sigops.org/s/conferences/sosp/2026/
    url_template: https://sigops.org/s/conferences/sosp/{year}/
    year: 2026
    month: 10
    formats: [Full paper, Short paper]
    tracks: [Research, Industry]
    deadlines:
      - name: Paper submission
        track: Research
        date: 2026-04-16T23:59:00-12:00
        confirmed: true
        source: https://sigops.org/s/conferences/sosp/2026/cfp.html
        verified_on: 2026-08-26
```

Full field reference: the comment block at the top of `conferences.yml`, and
the table in the README.

## Fix an estimated date

1. Find what the venue's own page says:
   ```bash
   python scripts/check_deadlines.py eurosys
   ```
   It prints the config's claim next to every deadline-looking line on the
   site, and writes nothing.
   If the site is JS-rendered or the dates are buried in prose, add
   `--firecrawl` — it renders the page properly and re-scans. Works without an
   API key; `FIRECRAWL_API_KEY` raises the rate limit and lets it find the
   venue's CFP page for you.
2. Correct the `date`, set `confirmed: true`, and add `source` + `verified_on`.

Neither tool writes to the config, on purpose. A page rendering correctly does
not make its dates current — several venues serve last year's call from this
year's URL. Read the output yourself before you set `confirmed: true`.

## Before you open a PR

```bash
python scripts/validate_config.py     # catches the mistakes this file attracts
python scripts/update.py --no-network # regenerate data/deadlines.json
```

CI runs the validator on every PR, so a structural mistake is caught for you.
**Do not hand-edit `data/deadlines.json`** — it is generated, and the next
build overwrites it.

### Things that will fail validation

| Mistake | Fix |
|---|---|
| `notes: Prefix the title: like this` | quote it — a value containing `": "` breaks YAML |
| `date: 2026-09-15T23:59:00` | add the offset — `-12:00` is AoE |
| `tier: tier1` | old name — use `royal-flush` (see hierarchy.html) |
| `url_template` with no `{year}` | it can never roll over; drop it or add the placeholder |
| a venue added twice | one entry per venue |

## Ranks

Venues are ranked `royal-flush`, `full-house`, `high-card` or `wild-card`,
not "tier 1/2" — **[hierarchy.html](hierarchy.html)** explains
what each means. The old names still parse, with a warning, so an existing
branch will not break.

Placement is a judgement call about how a venue *behaves* (selectivity,
audience, whether it has cycles), not about research quality. If one looks
wrong to you, that is a one-line change and a reasonable PR.

## Formats and tracks

`formats` (what a venue accepts) and `tracks` are optional and mostly empty,
on purpose — they are filled in only where the venue's CFP states them:

```bash
python scripts/check_deadlines.py --formats ccs asplos
```

That prints the page limits and track names it can find on each venue's call.
Copy what the page actually says; leave the field out otherwise. A blank
`formats` means "not stated yet", which is honest — an invented "accepts
posters" is the same failure as an invented deadline, just quieter.

Most venues fill these in only once their CFP is published, so expect coverage
to grow over the cycle rather than arrive all at once.

## Timezones

Conference deadlines are almost always **AoE** (Anywhere on Earth, UTC−12).
Write `-12:00` and the dashboard renders the correct calendar day. A bare
`2026-09-15` is treated as AoE end-of-day. A time with no offset is rejected —
that ambiguity is how a deadline silently shifts by a day.

## Biennial venues

Set `cycle_years: 2` (HotOS, for example) so rollover steps 2027 → 2029
instead of chasing a year the venue never runs in.
