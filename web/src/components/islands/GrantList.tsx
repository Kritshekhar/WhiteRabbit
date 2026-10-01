import { CalendarSync } from 'lucide-react';
import { useMemo, useState } from 'react';
import { decorate, fmtDate } from '@/lib/dates';
import { grantEvent } from '@/lib/calendar';
import { AUDIENCE_ELIGIBILITY, GOVERNMENT, GRANT_BANDS, WHO_SLOT, grantStatus, type Audience } from '@/lib/tiers';
import type { Grant } from '@/lib/types';
import { grantHref, href } from '@/lib/utils';
import { Badge } from '../ui/badge';
import { Row } from '../Row';
import { Chips, MultiSelect, SearchBox, Tile, Toggle } from '../Filters';
import { useNow, useQueryParam } from '../useNow';

/* One island, two pages: grants (faculty) and fellowships (students). */
export default function GrantList({ grants, audience, builtAt }: { grants: Grant[]; audience: Audience; builtAt: string }) {
  const now = useNow(builtAt);
  const student = audience === 'student';
  const [query, setQuery] = useQueryParam('q');
  const [who, setWho] = useState('all');
  const [kind, setKind] = useState('all');
  const [funders, setFunders] = useState<Set<string>>(new Set());
  const [ccs, setCcs] = useState<Set<string>>(new Set());
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [datedOnly, setDatedOnly] = useState(false);

  const all = useMemo(() => {
    const wanted = AUDIENCE_ELIGIBILITY[audience];
    return grants
      .filter((g) => wanted.includes(g.eligibility))
      .map((g) => decorate(g, now, GRANT_BANDS))
      .map((g) => ({ ...g, status: grantStatus(g) }));
  }, [grants, audience, now]);

  const countBy = (key: (g: Grant) => string) => {
    const m = new Map<string, number>();
    all.forEach((g) => { const k = key(g); if (k) m.set(k, (m.get(k) || 0) + 1); });
    return m;
  };
  const funderCounts = useMemo(() => countBy((g) => g.funder), [all]);
  const ccsCounts = useMemo(() => countBy((g) => g.ccs), [all]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((g) => {
        if (who !== 'all' && g.eligibility !== who) return false;
        if (kind !== 'all') {
          const isGov = GOVERNMENT.test(g.funder);
          if (kind === 'government' && !isGov) return false;
          if (kind === 'industry' && isGov) return false;
        }
        if (funders.size && !funders.has(g.funder)) return false;
        if (ccs.size && !ccs.has(g.ccs)) return false;
        if (onlyOpen && g.status === 'closed') return false;
        if (datedOnly && g.status !== 'open') return false;
        if (!q) return true;
        return `${g.name} ${g.funder} ${g.notes} ${g.topics.join(' ')} ${g.eligibility}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity) || a.name.localeCompare(b.name));
  }, [all, query, who, kind, funders, ccs, onlyOpen, datedOnly]);

  const open = all.filter((g) => g.status === 'open').sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  const undated = all.filter((g) => g.status === 'tba').length;
  const confirmed = all.filter((g) => g.deadlines.some((d) => d.confirmed)).length;
  const head = open[0];
  const funderTotal = new Set(all.map((g) => g.funder).filter(Boolean)).size;
  const verifiedOpen = open.filter((g) => g.next?.confirmed).length;

  const hero = head && head.next?.ts ? (
    <Tile
      hero
      label={head.days !== null && head.days <= 14 ? 'Due soon' : 'Next up'}
      value={head.name}
      note={`${head.funder} · ${head.days}d · ${fmtDate(head.next.ts, head.next.off)}`}
    />
  ) : (
    <Tile hero label="Nothing dated yet" value={`${all.length} programmes`} note={`across ${funderTotal} funders · none has published its next deadline`} />
  );

  return (
    <div className="space-y-5">
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="col-span-2 lg:col-span-1">{hero}</div>
        {student ? (
          <Tile label="Fellowships tracked" value={all.length} note="open to PhD students" />
        ) : (
          <Tile label="Open calls" value={open.length} note="accepting proposals" />
        )}
        <Tile
          label={open.length ? 'Closing within 60 days' : 'Dates not announced'}
          value={open.length ? open.filter((g) => (g.days ?? 0) <= 60).length : undated}
          note={open.length ? 'across all funders' : 'awaiting a published date'}
        />
        {student ? (
          <Tile label="Dates confirmed" value={confirmed} note={`of ${all.length} tracked`} />
        ) : (
          <Tile label="Programmes tracked" value={all.length} note={`${confirmed} with a confirmed date`} />
        )}
      </section>

      <section aria-label="Filters" className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <SearchBox
            value={query}
            onChange={setQuery}
            label={student ? 'Search fellowships' : 'Search grants'}
            placeholder={student ? 'Search fellowship or funder, e.g. Google' : 'Search programme or funder, e.g. NSF or CAREER'}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Toggle checked={onlyOpen} onChange={setOnlyOpen} label="Hide closed" />
            <Toggle checked={datedOnly} onChange={setDatedOnly} label="Dated only" />
            <MultiSelect label="Funders" counts={funderCounts} chosen={funders} onChange={setFunders} />
            <MultiSelect label="ACM class" counts={ccsCounts} chosen={ccs} onChange={setCcs} />
            <a href={href('calendar/')} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface-1 px-3 text-[0.8rem] font-semibold text-fg-2 no-underline hover:border-border-strong hover:text-fg">
              <CalendarSync className="size-3.5" aria-hidden="true" /> Subscribe
            </a>
          </div>
        </div>
        {student ? (
          <Chips label="Filter by funder type" value={kind} onChange={setKind}
            options={[{ value: 'all', label: 'All' }, { value: 'industry', label: 'Industry' }, { value: 'government', label: 'Government' }]} />
        ) : (
          <Chips label="Filter by career stage" value={who} onChange={setWho}
            options={[{ value: 'all', label: 'All' }, { value: 'Faculty / PI', label: 'Faculty / PI' }, { value: 'Early-career faculty', label: 'Early-career' }]} />
        )}
      </section>

      <p className="text-sm text-muted" aria-live="polite">
        {list.length} of {all.length} programmes
      </p>
      <section className="flex flex-col gap-2">
        {list.map((g) => (
          <Row
            key={g.id}
            href={grantHref(g.id)}
            title={g.name}
            /* With no date, the useful thing is when to look. Not `notes`:
               every federal record carries the same "due 5 p.m." line. */
            subtitle={
              g.status === 'tba' && g.typical_window
                ? g.typical_window
                : [g.amount, g.opportunity_number ? `Opportunity ${g.opportunity_number}` : ''].filter(Boolean).join(' · ')
            }
            tags={
              <>
                {g.funder && <Badge variant="publisher">{g.funder}</Badge>}
                {g.ccs && <Badge variant="ccs" title="ACM Computing Classification System">{g.ccs}</Badge>}
                {g.topics.slice(0, 1).map((t) => <Badge key={t}>{t}</Badge>)}
                <Badge variant={WHO_SLOT[g.eligibility] || 'base'}>{g.eligibility}</Badge>
              </>
            }
            deadline={g.next}
            days={g.days}
            band={g.band}
            statusText={g.status === 'closed' ? 'Closed, awaiting the next call' : 'Deadline not announced'}
            url={g.url}
            calendar={g.next ? grantEvent(g, g.next, true) : null}
          />
        ))}
      </section>
      {list.length === 0 && <p className="card p-8 text-center text-muted">No programmes match those filters.</p>}
      <p className="text-sm text-muted">
        {open.length
          ? `${verifiedOpen} of ${open.length} open deadlines have been checked against the funder's own record.`
          : `None of these ${all.length} programmes has published its next deadline. Each row links to the programme page; check there before planning.`}
      </p>
    </div>
  );
}
