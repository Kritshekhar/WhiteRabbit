import { CalendarSync } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { decorate, fmtDate } from '@/lib/dates';
import { venueEvent } from '@/lib/calendar';
import { VENUE_BANDS, venueStatus } from '@/lib/tiers';
import type { Venue } from '@/lib/types';
import { href, venueHref } from '@/lib/utils';
import { Row } from '../Row';
import { MultiSelect, SearchBox, Tile, Toggle } from '../Filters';
import { useNow, useQueryParam } from '../useNow';
import { useWatchlist, venueKey } from '@/lib/watchlist';
import { buildCalendar, downloadIcs, venueIcsEvents } from '@/lib/ics';
import { Star, X } from 'lucide-react';
import { DeadlineHeatmap } from '../DeadlineHeatmap';
import { areaLabel, areaOf } from '@/lib/areas';
import { deadlineMonth, MONTH_NAMES } from '@/lib/heatmap';

export default function ConferenceList({ venues, builtAt }: { venues: Venue[]; builtAt: string }) {
  const now = useNow(builtAt);
  const [query, setQuery] = useQueryParam('q');
  const [topics, setTopics] = useState<Set<string>>(new Set());
  const [onlyUpcoming, setOnlyUpcoming] = useState(true);
  const [sort, setSort] = useState<'deadline' | 'name'>('deadline');
  const watched = useWatchlist();
  const [starredOnly, setStarredOnly] = useState(false);
  /* heatmap cell: an area, a month (0-11), or both */
  const [area, setArea] = useState<string | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);   // closed by default
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const a = p.get('area');
    const m = Number(p.get('month'));
    if (a) setArea(a);
    if (p.has('month') && m >= 1 && m <= 12) setMonth(m - 1);
    if (a || p.has('month')) {
      setOnlyUpcoming(false);
      setCalendarOpen(true);   // arriving from a month or area link: show where it is
    }
  }, []);
  const pick = (a: string | null, m: number | null) => {
    setArea(a);
    setMonth(m);
    // a month is about the calendar, so show the venues whose cycle already passed too
    if (a !== null || m !== null) setOnlyUpcoming(false);
  };

  const all = useMemo(
    () => venues.map((v) => decorate(v, now, VENUE_BANDS)).map((v) => ({ ...v, status: venueStatus(v) })),
    [venues, now],
  );
  const topicCounts = useMemo(() => {
    const m = new Map<string, number>();
    venues.forEach((v) => v.topics.forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
    return m;
  }, [venues]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = all.filter((v) => {
      if (starredOnly && !watched.includes(venueKey(v.id))) return false;
      if (area && areaOf(v) !== area) return false;
      if (month !== null && deadlineMonth(v) !== month) return false;
      if (topics.size && !v.topics.some((t) => topics.has(t))) return false;
      if (onlyUpcoming && v.status === 'passed') return false;
      if (!q) return true;
      return `${v.name} ${v.full_name} ${v.notes} ${v.topics.join(' ')}`.toLowerCase().includes(q);
    });
    if (sort === 'name') return shown.sort((a, b) => a.name.localeCompare(b.name));
    /* Rolling venues sort to the top: no date, but "you can submit today" is
       the most actionable state on the page. */
    const rank = (v: (typeof all)[number]) => (v.rolling ? -1 : (v.days ?? Infinity));
    return shown.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [all, query, topics, onlyUpcoming, sort, starredOnly, watched, area, month]);
  const starredCount = venues.filter((v) => watched.includes(venueKey(v.id))).length;

  const upcoming = all.filter((v) => v.status === 'upcoming').sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  const head = upcoming[0];
  const count = (t: string) => venues.filter((v) => v.tier === t).length;
  const verified = upcoming.filter((v) => v.next?.confirmed).length;

  return (
    <div className="space-y-5">
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="col-span-2 lg:col-span-1">
          <Tile
            hero
            label={head && head.days !== null && head.days <= 7 ? 'Due soon' : 'Next up'}
            value={head ? `${head.name} · ${head.days}d` : 'Nothing scheduled'}
            note={head?.next?.ts ? `${head.next.name} · ${fmtDate(head.next.ts, head.next.off)} AoE${head.next.confirmed ? '' : ' (est.)'}` : 'no upcoming deadline'}
          />
        </div>
        <Tile label="Due within 30 days" value={upcoming.filter((v) => (v.days ?? 0) <= 30).length} note="across all stages" />
        <Tile label="Due within 90 days" value={upcoming.filter((v) => (v.days ?? 0) <= 90).length} note="plan the quarter" />
        <Tile
          label="Venues tracked"
          value={venues.length}
          note={`${count('rabbit-hole')} workshop · ${count('royal-flush') + count('full-house')} full paper · ${count('looking-glass')} journal`}
        />
      </section>

      <details className="card group p-4 sm:p-5" open={calendarOpen}
        onToggle={(e) => setCalendarOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3">
          <span>
            <span className="font-bold">Deadline calendar</span>
            <span className="ml-2 text-sm text-muted">When each venue's main deadline falls, by area. Click a cell to filter.</span>
          </span>
          <span className="text-xs font-semibold text-accent group-open:hidden">Show</span>
          <span className="hidden text-xs font-semibold text-accent group-open:inline">Hide</span>
        </summary>
        <div className="mt-4">
          <DeadlineHeatmap venues={venues} area={area} month={month} onPick={pick} currentMonth={new Date(now).getMonth()} />
          <p className="mt-2 text-xs text-muted">
            One deadline per venue (its paper submission), from its current cycle, estimated dates included. A cycle that has
            passed still counts in its month: that is roughly when the next call will be.
          </p>
        </div>
      </details>

      <section aria-label="Filters" className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <SearchBox value={query} onChange={setQuery} label="Search venues" placeholder="Search venue, e.g. OSDI or storage" />
          <div className="flex flex-wrap items-center gap-2">
            <Toggle checked={starredOnly} onChange={setStarredOnly} label={`Starred only${starredCount ? ` (${starredCount})` : ''}`} />
            <Toggle checked={onlyUpcoming} onChange={setOnlyUpcoming} label="Only upcoming" />
            <MultiSelect label="Topics" counts={topicCounts} chosen={topics} onChange={setTopics} />
            <a href={href('calendar/')} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface-1 px-3 text-[0.8rem] font-semibold text-fg-2 no-underline hover:border-border-strong hover:text-fg">
              <CalendarSync className="size-3.5" aria-hidden="true" /> Subscribe
            </a>
            <label className="inline-flex h-8 items-center">
              <span className="sr-only">Sort by</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as 'deadline' | 'name')}
                className="h-8 cursor-pointer rounded-full border border-border bg-surface-1 px-3 text-[0.8rem] font-semibold text-fg-2"
              >
                <option value="deadline">Sort: soonest first</option>
                <option value="name">Sort: name</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      <p className="flex flex-wrap items-center gap-2 text-sm text-muted" aria-live="polite">
        {list.length} of {venues.length} venues
        {(area || month !== null) && (
          <button type="button" onClick={() => pick(null, null)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-accent bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">
            {[area && areaLabel(area), month !== null && MONTH_NAMES[month]].filter(Boolean).join(' · ')}
            <X className="size-3.5" aria-label="Clear" />
          </button>
        )}
      </p>
      <section className="flex flex-col gap-2">
        {list.map((v) => (
          <Row
            key={v.id}
            href={venueHref(v.id)}
            title={v.name}
            subtitle={v.full_name}
            deadline={v.next}
            days={v.days}
            band={v.band}
            statusText={v.rolling ? 'Rolling submission' : v.status === 'passed' ? 'Cycle closed' : 'Deadline TBA'}
            url={v.url}
            calendar={v.next ? venueEvent(v, v.next, true) : null}
            watchKey={venueKey(v.id)}
          />
        ))}
      </section>
      {starredOnly && starredCount > 0 && (
        <button
          type="button"
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 self-start rounded-full border border-border bg-surface-1 px-3 text-[0.8rem] font-semibold text-fg-2 hover:border-border-strong hover:text-fg"
          onClick={() => downloadIcs('my-venues.ics', buildCalendar('White Rabbit: my venues', 'Deadlines of the venues you starred on White Rabbit.',
            venues.filter((v) => watched.includes(venueKey(v.id))).flatMap((v) => venueIcsEvents(v))))}
        >
          Download my starred deadlines (.ics)
        </button>
      )}
      {list.length === 0 && (
        <p className="card p-8 text-center text-muted">
          {starredOnly && !starredCount
            ? <>No starred venues yet. Use the <Star className="inline size-4 align-[-2px]" aria-label="star" /> on any row to add it to My venues.</>
            : 'No venues match those filters.'}
        </p>
      )}
      <p className="text-sm text-muted">
        {verified} of {upcoming.length} upcoming deadlines have been checked against the venue's own CFP page; the rest are
        extrapolated from previous cycles.
      </p>
    </div>
  );
}
