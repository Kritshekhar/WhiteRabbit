import { useMemo } from 'react';
import { heatmap, MONTH_NAMES, MONTHS } from '@/lib/heatmap';
import type { Venue } from '@/lib/types';
import { cn } from '@/lib/utils';

/* Areas down the side, months across, each cell the number of venues whose
   main deadline falls there. A cell is a button: it filters the list below.
   Colour is one hue at rising strength, and every cell also prints its number,
   so nothing depends on reading the colour. */
export function DeadlineHeatmap({ venues, area, month, onPick, currentMonth }: {
  venues: Venue[];
  area: string | null;
  month: number | null;
  onPick: (area: string | null, month: number | null) => void;
  currentMonth: number;
}) {
  const { rows, totals, max } = useMemo(() => heatmap(venues), [venues]);
  const maxTotal = Math.max(1, ...totals);
  const shade = (n: number) => (n ? 0.12 + 0.78 * (n / max) : 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-separate border-spacing-[3px] text-xs">
        <caption className="sr-only">Venues by research area and the month of their main submission deadline</caption>
        <thead>
          <tr>
            <th scope="col" className="w-48 text-left font-semibold text-muted" />
            {MONTHS.map((m, i) => (
              <th key={m} scope="col"
                className={cn('pb-1 text-center font-semibold', i === currentMonth ? 'text-accent' : 'text-muted')}>
                <button type="button" onClick={() => onPick(null, month === i && !area ? null : i)}
                  className="cursor-pointer rounded px-1 hover:text-fg" title={`Every area, ${MONTH_NAMES[i]}`}>
                  {m}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.slug}>
              <th scope="row" className="pr-2 text-left font-semibold whitespace-nowrap text-fg-2">
                <button type="button" onClick={() => onPick(area === r.slug && month === null ? null : r.slug, null)}
                  className={cn('cursor-pointer hover:text-fg', area === r.slug && month === null && 'text-accent')}>
                  {r.label}
                </button>
                <span className="ml-1 font-mono font-normal text-muted tabular">{r.total}</span>
              </th>
              {r.counts.map((n, i) => {
                const active = area === r.slug && month === i;
                return (
                  <td key={i} className="p-0">
                    <button
                      type="button"
                      disabled={!n}
                      onClick={() => onPick(active ? null : r.slug, active ? null : i)}
                      title={`${r.label}, ${MONTH_NAMES[i]}: ${n} venue${n === 1 ? '' : 's'}`}
                      aria-pressed={active}
                      className={cn(
                        'relative flex h-8 w-full items-center justify-center rounded-md font-mono font-semibold tabular transition',
                        n ? 'cursor-pointer hover:ring-2 hover:ring-accent' : 'cursor-default',
                        active && 'ring-2 ring-fg',
                        i === currentMonth && !n && 'bg-accent-soft/40',
                      )}
                      style={n ? { background: `color-mix(in srgb, var(--accent) ${Math.round(shade(n) * 100)}%, transparent)`,
                        color: shade(n) > 0.55 ? '#fff' : 'var(--text-primary)' } : undefined}
                    >
                      {n || ''}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <th scope="row" className="pt-1 pr-2 text-left font-semibold text-muted">All areas</th>
            {totals.map((n, i) => (
              <td key={i} className="p-0 pt-1 align-bottom">
                <div className="flex h-10 flex-col items-center justify-end gap-0.5" title={`${MONTH_NAMES[i]}: ${n} venues`}>
                  <span className="font-mono text-[0.7rem] text-muted tabular">{n}</span>
                  <span className={cn('w-4/5 rounded-sm', i === currentMonth ? 'bg-accent' : 'bg-border-strong')}
                    style={{ height: `${Math.max(2, (n / maxTotal) * 24)}px` }} />
                </div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
