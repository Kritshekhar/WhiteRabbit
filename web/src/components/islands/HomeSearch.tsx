import { useMemo, useState } from 'react';
import { href } from '@/lib/utils';
import { SearchIcon } from '../Icons';

export interface SearchEntry {
  kind: 'Conference' | 'Grant' | 'Fellowship';
  name: string;
  sub: string;
  href: string;
  text: string;
}

/* Instant matches across conferences and funding. Enter goes to the full,
   filtered conference list. */
export default function HomeSearch({ entries }: { entries: SearchEntry[] }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const starts = (e: SearchEntry) => (e.name.toLowerCase().startsWith(needle) ? 0 : 1);
    return entries.filter((e) => e.text.includes(needle)).sort((a, b) => starts(a) - starts(b)).slice(0, 8);
  }, [q, entries]);

  return (
    <form
      action={href('conferences/')}
      method="get"
      role="search"
      className="relative w-full max-w-2xl"
      onSubmit={(e) => {
        if (hits.length && hits[0].kind !== 'Conference') {
          e.preventDefault();
          window.location.href = hits[0].href;
        }
      }}
    >
      <label className="sr-only" htmlFor="home-q">Search conferences, grants and fellowships</label>
      <SearchIcon className="pointer-events-none absolute top-[1.55rem] left-4 size-5 -translate-y-1/2 text-muted" />
      <input
        id="home-q"
        name="q"
        type="search"
        autoComplete="off"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search OSDI, NeurIPS, NSF CAREER, fellowships..."
        className="h-[3.1rem] w-full rounded-2xl border border-border bg-surface-1 pr-24 pl-12 text-base text-fg shadow-card placeholder:text-muted"
        aria-controls="home-hits"
      />
      <button type="submit" className="absolute top-1.5 right-1.5 h-[2.35rem] cursor-pointer rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:brightness-110">
        Search
      </button>
      {q.trim() && (
        <ul id="home-hits" className="card absolute inset-x-0 top-[3.5rem] z-20 max-h-96 overflow-y-auto p-1.5">
          {hits.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matches. Press Enter to search conferences.</li>}
          {hits.map((h) => (
            <li key={h.href}>
              <a href={h.href} className="flex items-center gap-3 rounded-lg px-3 py-2 no-underline hover:bg-surface-2">
                <span className="w-20 shrink-0 text-[0.7rem] font-semibold tracking-wide text-muted uppercase">{h.kind}</span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-fg">{h.name}</span>
                  {h.sub && <span className="block truncate text-xs text-muted">{h.sub}</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
