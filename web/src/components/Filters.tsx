import { useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { ChevronIcon, SearchIcon } from './Icons';
import { cn } from '@/lib/utils';

export function SearchBox({ value, onChange, placeholder, label }: {
  value: string; onChange: (v: string) => void; placeholder: string; label: string;
}) {
  return (
    <label className="relative block w-full md:max-w-sm">
      <span className="sr-only">{label}</span>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="h-10 w-full rounded-xl border border-border bg-surface-1 pr-3 pl-9 text-sm text-fg shadow-sm placeholder:text-muted"
      />
    </label>
  );
}

export function Chips<T extends string>({ options, value, onChange, label, extra }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; extra?: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-8 cursor-pointer rounded-full border px-3 text-[0.8rem] font-semibold transition-colors',
            value === o.value
              ? 'border-fg bg-fg text-surface-0'
              : 'border-border bg-surface-1 text-fg-2 hover:border-border-strong hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
      {extra}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex h-8 cursor-pointer items-center gap-2 text-[0.82rem] font-semibold text-fg-2 select-none">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className="relative h-5 w-9 rounded-full border border-border-strong bg-surface-2 transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent after:absolute after:top-0.5 after:left-0.5 after:size-3.5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4"
      />
      {label}
    </label>
  );
}

/* A checkbox list in a popover, with counts per option. */
export function MultiSelect({ label, counts, chosen, onChange }: {
  label: string; counts: Map<string, number>; chosen: Set<string>; onChange: (s: Set<string>) => void;
}) {
  const options = useMemo(
    () => [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    [counts],
  );
  const summary = chosen.size === 0 ? 'all' : chosen.size === 1 ? [...chosen][0] : `${chosen.size} selected`;
  const toggle = (key: string) => {
    const next = new Set(chosen);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'inline-flex h-8 max-w-[16rem] cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[0.8rem] font-semibold',
          chosen.size ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface-1 text-fg-2 hover:border-border-strong',
        )}
      >
        <span className="truncate">{label}: {summary}</span>
        <ChevronIcon className="size-3.5 shrink-0" />
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex items-center justify-between px-2 pb-1.5">
          <span className="text-xs font-semibold text-muted uppercase">{label}</span>
          <button type="button" className="cursor-pointer text-xs font-semibold text-accent disabled:opacity-40" disabled={!chosen.size} onClick={() => onChange(new Set())}>
            Clear all
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {options.map(([key, n]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={chosen.has(key)} onChange={() => toggle(key)} />
              <span className="min-w-0 flex-1 truncate">{key}</span>
              <span className="font-mono text-xs text-muted tabular">{n}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function Tile({ label, value, note, hero }: { label: string; value: React.ReactNode; note: React.ReactNode; hero?: boolean }) {
  return (
    <article className={cn('card min-w-0 p-4', hero && 'sm:col-span-2 lg:col-span-1 bg-linear-to-br from-accent-soft to-surface-1')}>
      <p className="text-[0.72rem] font-semibold tracking-wide text-muted uppercase">{label}</p>
      {/* a long programme name wraps onto two lines in a smaller size instead of being cut */}
      <p className={`mt-1 font-bold tracking-tight tabular ${typeof value === 'string' && value.length > 24 ? 'line-clamp-2 text-lg leading-snug' : 'truncate text-2xl'}`}
        title={typeof value === 'string' ? value : undefined}>{value}</p>
      <p className="mt-0.5 text-[0.8rem] text-fg-2">{note}</p>
    </article>
  );
}
