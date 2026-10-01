import { useMemo, useState } from 'react';
import { RANK_SLOT, TIERS } from '@/lib/tiers';
import { href } from '@/lib/utils';
import { SearchIcon } from '../Icons';
import { Badge } from '../ui/badge';

export interface PickerVenue {
  id: string;
  name: string;
  full_name: string;
  tier: string;
  latest: number | null;
}

const ORDER = ['royal-flush', 'full-house', 'rabbit-hole', 'looking-glass'];
const proceedingsHref = (id: string) => href(`proceedings/${encodeURIComponent(id)}/`);

/* Only venues that have proceedings data, grouped by tier. `compact` is the
   search-as-you-type box used on a venue's own page. */
export default function VenuePicker({ venues, current, compact = false }: { venues: PickerVenue[]; current?: string; compact?: boolean }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => venues.filter((v) => !needle || `${v.name} ${v.full_name}`.toLowerCase().includes(needle)),
    [venues, needle],
  );

  const box = (
    <label className="relative block w-full sm:max-w-sm">
      <span className="sr-only">Find a venue</span>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) window.location.href = proceedingsHref(shown[0].id); }}
        placeholder={`Find one of ${venues.length} venues with data`}
        autoComplete="off"
        className="h-10 w-full rounded-xl border border-border bg-surface-1 pr-3 pl-9 text-sm text-fg shadow-sm placeholder:text-muted"
      />
    </label>
  );

  if (compact) {
    return (
      <div className="relative">
        {box}
        {needle && (
          <ul className="card absolute z-20 mt-1.5 max-h-80 w-full overflow-y-auto p-1.5 sm:max-w-sm">
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">No venue with data matches.</li>}
            {shown.slice(0, 12).map((v) => (
              <li key={v.id}>
                <a href={proceedingsHref(v.id)} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 no-underline hover:bg-surface-2">
                  <span className="min-w-0 truncate font-semibold">{v.name}</span>
                  {v.latest !== null && <span className="font-mono text-xs text-muted">{v.latest}</span>}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {box}
      {shown.length === 0 && <p className="text-sm text-muted">No venue with data matches.</p>}
      {ORDER.map((tier) => {
        const group = shown.filter((v) => v.tier === tier);
        if (!group.length) return null;
        return (
          <section key={tier}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
              <Badge variant={RANK_SLOT[tier] || 'off'}>{TIERS[tier]}</Badge> {group.length}
            </h3>
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
              {group.map((v) => (
                <li key={v.id}>
                  <a
                    href={proceedingsHref(v.id)}
                    aria-current={v.id === current ? 'page' : undefined}
                    title={v.full_name}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm no-underline hover:border-border-strong aria-[current=page]:border-accent aria-[current=page]:bg-accent-soft"
                  >
                    <span className="min-w-0 truncate font-semibold">{v.name}</span>
                    {v.latest !== null && <span className="shrink-0 font-mono text-xs text-muted">{v.latest}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
