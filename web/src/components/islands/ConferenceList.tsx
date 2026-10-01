import { useMemo, useState } from 'react';
import { decorate, fmtDate } from '@/lib/dates';
import { venueEvent } from '@/lib/calendar';
import { VENUE_BANDS, venueStatus } from '@/lib/tiers';
import type { Venue } from '@/lib/types';
import { venueHref } from '@/lib/utils';
import { Row } from '../Row';
import { MultiSelect, SearchBox, Tile, Toggle } from '../Filters';
import { useNow, useQueryParam } from '../useNow';

export default function ConferenceList({ venues, builtAt }: { venues: Venue[]; builtAt: string }) {
  const now = useNow(builtAt);
  const [query, setQuery] = useQueryParam('q');
  const [topics, setTopics] = useState<Set<string>>(new Set());
  const [onlyUpcoming, setOnlyUpcoming] = useState(true);
  const [sort, setSort] = useState<'deadline' | 'name'>('deadline');

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
  }, [all, query, topics, onlyUpcoming, sort]);

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
            label={head && head.days !== null && head.days <= 7 ? "I'm late! I'm late!" : 'Next up'}
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

      <section aria-label="Filters" className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <SearchBox value={query} onChange={setQuery} label="Search venues" placeholder="Search venue, e.g. OSDI or storage" />
          <div className="flex flex-wrap items-center gap-2">
            <Toggle checked={onlyUpcoming} onChange={setOnlyUpcoming} label="Only upcoming" />
            <MultiSelect label="Topics" counts={topicCounts} chosen={topics} onChange={setTopics} />
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

      <p className="text-sm text-muted" aria-live="polite">
        {list.length} of {venues.length} venues
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
          />
        ))}
      </section>
      {list.length === 0 && <p className="card p-8 text-center text-muted">No venues match those filters.</p>}
      <p className="text-sm text-muted">
        {verified} of {upcoming.length} upcoming deadlines have been checked against the venue's own CFP page; the rest are
        extrapolated from previous cycles.
      </p>
    </div>
  );
}
