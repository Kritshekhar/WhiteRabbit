# Contributing

The data is kept in a private repository, so the way to correct or add a
date is an issue: use the **Wrong date** or **Add a venue** form, with the
venue, the date and the link you read it on. Code changes are welcome as pull
requests here.

The rest of this guide is for maintainers with access to the data, which is
checked out at `data/` (`git clone git@github.com:Kritshekhar/WhiteRabbit-data.git data`).
It is `data/whiterabbit.sql`, a text dump of a SQLite database with one row
per line. The easy way to change it is `scripts/wr.py`, which needs nothing
but Python 3:

```bash
python scripts/wr.py show eurosys       # what we have now
```

Every `wr.py` command rewrites the dump, so the change is an ordinary diff in
the data repository: commit and push it there. The site picks it up at its
next scheduled build, or at once with `gh workflow run deploy-pages.yml`.

## The one rule

**A date is either verified or it is estimated, and the data must say which.**

Verified means *you personally read this date on that page*. It earns a
**✓ verified** badge that links to the source, so any reader can re-check it.
Everything else renders **est.**, an honest "we guessed from last year".

```bash
python scripts/wr.py verify fast --source https://www.usenix.org/conference/fast27
python scripts/wr.py verify eurosys --deadline "Fall round" --date 2026-09-24T23:59:00-12:00 \
    --source https://2027.eurosys.org/cfp
```

`verify` is the only way a row becomes verified, and the database refuses one
without a `--source`. Once verified, a row is final: the crawlers never fetch
it again.

Never verify a date because it looks right. Several venues serve stale calls:
NDSS's 2027 page showed 2024 dates, SIGCOMM's 2027 site still carries the 2026
call. If the page does not state the date for *this* edition, leave it
estimated.

## Add a venue

Only the name is required; everything else has a default.

```bash
python scripts/wr.py add-venue SOSP --full-name "ACM Symposium on Operating Systems Principles" \
    --tier royal-flush --url https://sigops.org/s/conferences/sosp/2026/ \
    --url-template "https://sigops.org/s/conferences/sosp/{year}/" --year 2026 --month 10 \
    --topic Systems --publisher ACM
python scripts/wr.py set sosp formats "Full paper, Short paper"
python scripts/wr.py set sosp tracks "Research, Industry"
python scripts/wr.py add-deadline sosp "Paper submission" 2026-04-16T23:59:00-12:00 --track Research
python scripts/wr.py verify sosp --source https://sigops.org/s/conferences/sosp/2026/cfp.html
```

Field reference: the venue table in the README, and `db/schema.sql`.

## Fix an estimated date

1. See what is still unverified, and what the venue's own page says:
   ```bash
   python scripts/wr.py queue
   python scripts/check_deadlines.py eurosys
   ```
   `check_deadlines.py` prints the database's claim next to every
   deadline-looking line on the site, and writes nothing.
   If the site is JS-rendered or the dates are buried in prose, add
   `--firecrawl` - it renders the page properly and re-scans. Works without an
   API key; `FIRECRAWL_API_KEY` raises the rate limit and lets it find the
   venue's CFP page for you.
2. Read the page yourself, then `wr.py verify` with `--date` if it changed.

The tools never write dates on their own, on purpose. A page rendering
correctly does not make its dates current - several venues serve last year's
call from this year's URL.

## Before you open a PR

```bash
python scripts/db.py check               # catches what the schema cannot
```

CI runs it on every PR and checks that the dump is in canonical form, so a
hand-edited dump should be passed through `python scripts/db.py build && python
scripts/db.py dump` first.

### Things that will be refused

| Mistake | Fix |
|---|---|
| verifying without `--source` | add the page you read the date on |
| `2026-09-15T23:59:00` | add the offset - `-12:00` is AoE |
| a tier that is not one of the four stages | see below |
| `url_template` with no `{year}` | it can never roll over; leave it empty or add the placeholder |
| a URL that is not `http(s)://` | use the full link |
| a venue added twice | one entry per venue |

## Stages

Venues are placed by stage - `rabbit-hole`, `royal-flush`, `full-house`,
`looking-glass` - not "tier 1/2" - **[About](https://kritshekhar.github.io/WhiteRabbit/about/)** explains
what each means.

Placement is a judgement call about how a venue *behaves* (selectivity,
audience, whether it has cycles), not about research quality. If one looks
wrong to you, that is a one-line change and a reasonable PR.

## Formats and tracks

`formats` (what a venue accepts) and `tracks` are optional and mostly empty,
on purpose - they are filled in only where the venue's CFP states them:

```bash
python scripts/check_deadlines.py --formats ccs asplos
```

That prints the page limits and track names it can find on each venue's call.
Copy what the page actually says; leave the field empty otherwise. A blank
`formats` means "not stated yet", which is honest - an invented "accepts
posters" is the same failure as an invented deadline, just quieter.

## Proceedings statistics

Paper counts and keywords come from DBLP and need a venue's DBLP stream. When
a venue's name does not match one exactly, the pipeline proposes a key instead
of guessing; `wr.py queue` lists them. Check the proposed DBLP page, then:

```bash
python scripts/wr.py set imc dblp_key conf/imc
```

## Timezones

Conference deadlines are almost always **AoE** (Anywhere on Earth, UTC−12).
Write `-12:00` and the site renders the correct calendar day. A bare
`2026-09-15` is treated as AoE end-of-day. A time with no offset is rejected  - 
that ambiguity is how a deadline silently shifts by a day.

## Biennial venues

Set `cycle_years` to 2 (HotOS, for example) so rollover steps 2027 → 2029
instead of chasing a year the venue never runs in.
