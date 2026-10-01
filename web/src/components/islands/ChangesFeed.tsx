import { useMemo, useState } from 'react';
import { BadgeCheck, CalendarPlus, PencilLine, RefreshCw, Trash2 } from 'lucide-react';
import type { ChangeItem } from '@/lib/changes';
import { Chips, SearchBox } from '../Filters';

const KIND = {
  verified: { label: 'Verified', Icon: BadgeCheck, color: 'var(--good)' },
  corrected: { label: 'Corrected', Icon: PencilLine, color: 'var(--serious)' },
  added: { label: 'Added', Icon: CalendarPlus, color: 'var(--accent)' },
  rolled_over: { label: 'New cycle', Icon: RefreshCw, color: 'var(--rank-mid)' },
  removed: { label: 'Removed', Icon: Trash2, color: 'var(--text-muted)' },
} as const;

const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/* Every change, newest first, grouped by day, filterable by kind and section. */
export default function ChangesFeed({ items }: { items: ChangeItem[] }) {
  const [kind, setKind] = useState('all');
  const [section, setSection] = useState('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(60);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((c) => (kind === 'all' || c.kind === kind)
      && (section === 'all' || c.section === section)
      && (!q || `${c.name} ${c.deadline} ${c.headline}`.toLowerCase().includes(q)));
  }, [items, kind, section, query]);

  const days = useMemo(() => {
    const out: [string, ChangeItem[]][] = [];
    for (const c of list.slice(0, shown)) {
      const last = out[out.length - 1];
      if (last && last[0] === c.day) last[1].push(c);
      else out.push([c.day, [c]]);
    }
    return out;
  }, [list, shown]);

  const count = (k: string) => items.filter((c) => c.kind === k).length;
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SearchBox value={query} onChange={setQuery} label="Search changes" placeholder="Search venue or deadline, e.g. OSDI" />
        <Chips label="Section" value={section} onChange={setSection}
          options={[{ value: 'all', label: 'Everything' }, { value: 'conferences', label: 'Conferences' },
            { value: 'grants', label: 'Grants' }, { value: 'fellowships', label: 'Fellowships' }]} />
      </div>
      <Chips label="Kind of change" value={kind} onChange={setKind}
        options={[{ value: 'all', label: `All ${items.length}` },
          ...(['verified', 'corrected', 'added', 'rolled_over'] as const).filter((k) => count(k))
            .map((k) => ({ value: k, label: `${KIND[k].label} ${count(k)}` }))]} />

      {days.length === 0 && <p className="card p-8 text-center text-muted">No changes match those filters.</p>}
      {days.map(([day, entries]) => (
        <section key={day} aria-label={dayLabel(day)}>
          <h2 className="mb-2 text-sm font-semibold text-muted">{dayLabel(day)} <span className="font-normal">· {entries.length}</span></h2>
          <ol className="card divide-y divide-border">
            {entries.map((c) => {
              const k = KIND[c.kind];
              return (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <k.Icon className="mt-0.5 size-4 shrink-0" style={{ color: k.color }} aria-label={k.label} />
                  <div className="min-w-0 flex-1">
                    <a href={c.href} className="font-semibold text-fg no-underline hover:text-accent">{c.name}</a>
                    <p className="text-sm text-fg-2">{c.headline}</p>
                  </div>
                  {c.source && (
                    <a href={c.source} target="_blank" rel="noopener" className="shrink-0 text-xs font-semibold text-muted hover:text-accent">
                      source ↗
                    </a>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {list.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + 100)}
          className="mx-auto block cursor-pointer rounded-full border border-border px-4 py-1.5 text-sm font-semibold text-fg-2 hover:border-border-strong">
          Show more ({list.length - shown} left)
        </button>
      )}
    </div>
  );
}
