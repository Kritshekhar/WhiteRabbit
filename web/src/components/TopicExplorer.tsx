import { useMemo, useState } from 'react';
import type { TermCount } from '@/lib/types';

/* OpenAlex topics for one venue, explorable by year.

   One row per topic: full name on one line, a bar that animates between years,
   the count and its share of the year's topic tags, and, when comparing, the
   change in share against another year. Selecting a topic draws its share over
   every year that has topic data. Bars are plain elements rather than a chart
   library so the labels never wrap into each other and rows are focusable. */

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

export default function TopicExplorer({ topics, year, onYear }: {
  topics: TermCount[];
  year: number | null;
  onYear: (y: number) => void;
}) {
  const years = useMemo(() => [...new Set(topics.map((t) => t.year))].sort((a, b) => b - a), [topics]);
  const current = year !== null && years.includes(year) ? year : years[0];
  const [compare, setCompare] = useState<number | null>(null);
  const [mode, setMode] = useState<'count' | 'share'>('share');
  const [picked, setPicked] = useState<string | null>(null);

  // share of each topic within its year, so years of different size compare fairly
  const byYear = useMemo(() => {
    const out = new Map<number, Map<string, { count: number; share: number }>>();
    for (const y of years) {
      const rows = topics.filter((t) => t.year === y);
      const total = rows.reduce((n, t) => n + t.count, 0) || 1;
      out.set(y, new Map(rows.map((t) => [t.term, { count: t.count, share: t.count / total }])));
    }
    return out;
  }, [topics, years]);

  const rows = useMemo(() => {
    const now = byYear.get(current) ?? new Map();
    return [...now.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12)
      .map(([term, v]) => ({ term, ...v, before: compare !== null ? byYear.get(compare)?.get(term) ?? null : null }));
  }, [byYear, current, compare]);

  const max = Math.max(...rows.map((r) => (mode === 'share' ? r.share : r.count)), 0.0001);
  const trendTerm = picked && byYear.get(current)?.has(picked) ? picked : rows[0]?.term ?? null;
  const trend = trendTerm
    ? [...years].reverse().map((y) => ({ year: y, share: byYear.get(y)?.get(trendTerm)?.share ?? 0 }))
    : [];

  if (!years.length) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Year">
          {years.slice(0, 12).map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => onYear(y)}
              aria-pressed={y === current}
              className="h-7 cursor-pointer rounded-full border border-border px-2.5 text-[0.78rem] font-semibold text-fg-2 transition hover:border-border-strong aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent"
            >
              {y}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <span className="font-semibold text-fg-2">Compare with</span>
          <select
            value={compare ?? ''}
            onChange={(e) => setCompare(e.target.value ? Number(e.target.value) : null)}
            className="h-7 cursor-pointer rounded-full border border-border bg-surface-1 px-2.5 text-[0.78rem] font-semibold"
          >
            <option value="">nothing</option>
            {years.filter((y) => y !== current).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <div className="ml-auto inline-flex rounded-full border border-border p-0.5" role="group" aria-label="Show">
          {(['share', 'count'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className="h-6 cursor-pointer rounded-full px-2.5 text-[0.75rem] font-semibold text-muted aria-pressed:bg-surface-2 aria-pressed:text-fg"
            >
              {m === 'share' ? 'Share' : 'Papers'}
            </button>
          ))}
        </div>
      </div>

      <ol className="space-y-1">
        {rows.map((r, i) => {
          const value = mode === 'share' ? r.share : r.count;
          const delta = r.before ? r.share - r.before.share : compare !== null ? r.share : null;
          const active = r.term === trendTerm;
          return (
            <li key={r.term}>
              <button
                type="button"
                onClick={() => setPicked(r.term)}
                aria-pressed={active}
                title={`${r.term}: ${r.count} papers in ${current}, ${pct(r.share)} of topic tags`}
                className="group grid w-full cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-2 aria-pressed:bg-accent-soft sm:grid-cols-[1.5rem_minmax(0,24rem)_minmax(0,1fr)_auto]"
              >
                <span className="font-mono text-xs text-muted tabular">{i + 1}</span>
                <span className="truncate text-sm font-semibold text-fg group-aria-pressed:text-accent">{r.term}</span>
                <span className="col-span-3 row-start-2 h-2.5 rounded-full bg-surface-2 sm:col-span-1 sm:row-start-auto">
                  <span
                    className="block h-full rounded-full bg-rank-base transition-[width] duration-500 ease-out group-aria-pressed:bg-accent"
                    style={{ width: `${(value / max) * 100}%` }}
                  />
                </span>
                <span className="col-start-3 row-start-1 flex items-baseline justify-end gap-2 font-mono text-xs tabular sm:col-start-auto sm:row-start-auto">
                  <span className="text-fg">{mode === 'share' ? pct(r.share) : r.count}</span>
                  {delta !== null && (
                    <span className={delta > 0.002 ? 'text-good' : delta < -0.002 ? 'text-critical' : 'text-muted'}>
                      {r.before === null ? 'new' : `${delta > 0 ? '▲' : delta < 0 ? '▼' : ''}${Math.abs(delta * 100).toFixed(1)}pt`}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {trendTerm && trend.length > 1 && <TopicTrend term={trendTerm} points={trend} current={current} onYear={onYear} />}
    </div>
  );
}

/* Share of one topic across the years that have topic data. */
function TopicTrend({ term, points, current, onYear }: {
  term: string; points: { year: number; share: number }[]; current: number; onYear: (y: number) => void;
}) {
  const w = 640;
  const h = 120;
  const pad = 24;
  const max = Math.max(...points.map((p) => p.share), 0.01);
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (s: number) => h - pad - (s / max) * (h - pad * 2);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.share).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${h - pad} L${x(0).toFixed(1)},${h - pad} Z`;

  return (
    <figure className="rounded-xl border border-border bg-surface-0 p-3">
      <figcaption className="mb-1 text-sm">
        <span className="font-semibold">{term}</span>
        <span className="text-muted"> · share of topic tags by year. Click a point to switch year.</span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full max-w-3xl" role="img" aria-label={`Share of ${term} by year`}>
        <path d={area} fill="var(--accent)" opacity="0.12" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={p.year} className="cursor-pointer" onClick={() => onYear(p.year)}>
            <title>{`${p.year}: ${pct(p.share)}`}</title>
            <circle cx={x(i)} cy={y(p.share)} r={p.year === current ? 5 : 3.5}
              fill={p.year === current ? 'var(--accent)' : 'var(--surface-1)'} stroke="var(--accent)" strokeWidth="2" />
            <circle cx={x(i)} cy={y(p.share)} r="12" fill="transparent" />
            {(i === 0 || i === points.length - 1 || p.year === current) && (
              <text x={x(i)} y={h - 6} textAnchor="middle" fontSize="13" fill="var(--text-muted)">{p.year}</text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  );
}
