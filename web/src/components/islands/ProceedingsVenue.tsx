import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TermCount } from '@/lib/types';
import { Badge } from '../ui/badge';
import { Panel } from '../Panel';

export interface YearRow {
  year: number;
  count: number | null;
  rate: number | null;
  status: 'verified' | 'in-progress' | 'unverified';
  source: string;
}

type KeywordFile = { years: Record<string, [string, number, number | null][]> };

const axis = { stroke: 'var(--text-muted)', fontSize: 12 };
const tooltip = {
  contentStyle: { background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-primary)' },
  labelStyle: { color: 'var(--text-secondary)' },
  cursor: { fill: 'var(--surface-2)' },
};
const statusColor = { verified: 'var(--accent)', 'in-progress': 'var(--warning)', unverified: 'var(--border-strong)' };

/* Everything mined from one venue's past proceedings. Year rows and topics
   arrive as props; the keyword file (every year's keywords) is fetched, so the
   page itself stays small. */
export default function ProceedingsVenue({ rows, topics, keywordsUrl, defaultYear }: {
  rows: YearRow[]; topics: TermCount[]; keywordsUrl: string; defaultYear: number | null;
}) {
  const [kw, setKw] = useState<KeywordFile | null>(null);
  const [kwError, setKwError] = useState(false);
  const [year, setYear] = useState<number | null>(defaultYear);
  const [term, setTerm] = useState('');

  useEffect(() => {
    fetch(keywordsUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: KeywordFile) => setKw(data))
      .catch(() => setKwError(true));
  }, [keywordsUrl]);

  const counted = rows.filter((r) => r.count !== null);
  const rates = rows.filter((r) => r.rate !== null).map((r) => ({ year: r.year, pct: Math.round((r.rate as number) * 1000) / 10 }));
  const kwYears = useMemo(() => (kw ? Object.keys(kw.years).map(Number).sort((a, b) => b - a) : []), [kw]);
  const yearKeywords = kw && year !== null ? kw.years[year] ?? [] : [];

  // default the trend to the chosen year's top keyword
  useEffect(() => { if (!term && yearKeywords[0]) setTerm(yearKeywords[0][0]); }, [yearKeywords, term]);

  const allTerms = useMemo(() => {
    if (!kw) return [];
    const totals = new Map<string, number>();
    Object.values(kw.years).forEach((list) => list.forEach(([t, c]) => totals.set(t, (totals.get(t) || 0) + c)));
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [kw]);

  const trend = useMemo(() => {
    if (!kw || !term || !counted.length) return [];
    const first = counted[0].year;
    const last = counted[counted.length - 1].year;
    const out = [];
    for (let y = first; y <= last; y += 1) {
      const hit = (kw.years[y] || []).find(([t]) => t === term);
      out.push({ year: y, count: hit ? hit[1] : 0 });
    }
    return out;
  }, [kw, term, counted]);

  const topicYears = useMemo(() => [...new Set(topics.map((t) => t.year))].sort((a, b) => b - a), [topics]);
  const topicYear = year !== null && topicYears.includes(year) ? year : topicYears[0];
  const topicRows = topics.filter((t) => t.year === topicYear).sort((a, b) => b.count - a.count).slice(0, 12);

  return (
    <div className="space-y-6">
      <Panel
        title="Papers in main proceedings (DBLP)"
        note="Counts papers published in the venue's main DBLP volume each year. This is not an official acceptance count: it can include short papers and exclude workshop or companion volumes."
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={counted} margin={{ left: -12, right: 8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="year" tick={axis} stroke="var(--border)" minTickGap={16} />
            <YAxis tick={axis} stroke="var(--border)" allowDecimals={false} />
            <Tooltip {...tooltip} formatter={(v) => [v, 'papers']} />
            <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {counted.map((r) => <Cell key={r.year} fill={statusColor[r.status]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span><span className="mr-1 inline-block size-2.5 rounded-sm bg-accent align-middle" />verified volume</span>
          <span><span className="mr-1 inline-block size-2.5 rounded-sm bg-warning align-middle" />in progress</span>
          <span><span className="mr-1 inline-block size-2.5 rounded-sm bg-border-strong align-middle" />not yet verified</span>
        </p>
      </Panel>

      {rates.length > 0 && (
        <Panel title="Acceptance rate" note="Only years where the venue published a figure.">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={rates} margin={{ left: -12, right: 8 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="year" tick={axis} stroke="var(--border)" />
              <YAxis tick={axis} stroke="var(--border)" unit="%" />
              <Tooltip {...tooltip} formatter={(v) => [`${v}%`, 'accepted']} />
              <Line dataKey="pct" stroke="var(--rank-mid)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      )}

      <Panel title="Keywords" note="Phrases from paper titles, weighted against all venues so each venue's distinctive terms rise to the top.">
        {kwError && <p className="text-sm text-muted">Keyword data could not be loaded.</p>}
        {!kw && !kwError && <p className="text-sm text-muted">Loading keywords...</p>}
        {kw && kwYears.length === 0 && <p className="text-sm text-muted">No keywords mined for this venue yet.</p>}
        {kw && kwYears.length > 0 && (
          <div className="space-y-5">
            <label className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-fg-2">Year</span>
              <select
                value={year ?? ''}
                onChange={(e) => setYear(Number(e.target.value))}
                className="h-8 cursor-pointer rounded-full border border-border bg-surface-1 px-3 text-[0.8rem] font-semibold"
              >
                {kwYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            {yearKeywords.length ? (
              <div className="flex flex-wrap gap-1.5">
                {yearKeywords.slice(0, 40).map(([t, c]) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTerm(t)}
                    aria-pressed={t === term}
                    className="cursor-pointer rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-[0.78rem] font-semibold text-fg-2 hover:border-border-strong aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent"
                  >
                    {t} <span className="font-mono text-muted">{c}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No keywords for {year}.</p>
            )}

            <div>
              <label className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-fg-2">Trend for</span>
                <input
                  list="kw-terms"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  className="h-8 w-56 max-w-full rounded-full border border-border bg-surface-1 px-3 text-[0.8rem]"
                  aria-label="Keyword to chart across years"
                />
                <datalist id="kw-terms">{allTerms.slice(0, 500).map((t) => <option key={t} value={t} />)}</datalist>
              </label>
              {trend.length > 0 && (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trend} margin={{ left: -12, right: 8, top: 12 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="year" tick={axis} stroke="var(--border)" minTickGap={16} />
                    <YAxis tick={axis} stroke="var(--border)" allowDecimals={false} />
                    <Tooltip {...tooltip} formatter={(v) => [v, `titles with "${term}"`]} />
                    <Line dataKey="count" stroke="var(--rank-base)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </Panel>

      {topicRows.length > 0 && (
        <Panel title={`Topic breakdown, ${topicYear}`} note="OpenAlex topics of the year's papers. Pick another year above to compare.">
          <ResponsiveContainer width="100%" height={Math.max(160, topicRows.length * 28)}>
            <BarChart data={topicRows} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" tick={axis} stroke="var(--border)" allowDecimals={false} />
              <YAxis type="category" dataKey="term" width={170} tick={{ ...axis, fill: 'var(--text-secondary)' }} stroke="var(--border)" />
              <Tooltip {...tooltip} formatter={(v) => [v, 'papers']} />
              <Bar dataKey="count" fill="var(--rank-base)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      )}

      <Panel title="Year by year">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs text-muted uppercase">
              <tr><th className="py-1.5 pr-4">Year</th><th className="py-1.5 pr-4 text-right">Papers (DBLP)</th>{rates.length > 0 && <th className="py-1.5 pr-4 text-right">Acceptance</th>}<th className="py-1.5">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...rows].reverse().map((r) => (
                <tr key={r.year}>
                  <td className="py-1.5 pr-4 font-semibold tabular">{r.year}</td>
                  <td className="py-1.5 pr-4 text-right tabular">{r.count?.toLocaleString() ?? 'n/a'}</td>
                  {rates.length > 0 && <td className="py-1.5 pr-4 text-right tabular">{r.rate !== null ? `${(r.rate * 100).toFixed(1)}%` : ''}</td>}
                  <td className="py-1.5"><YearBadge row={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export function YearBadge({ row }: { row: Pick<YearRow, 'status' | 'source'> }) {
  if (row.status === 'verified') {
    return row.source ? (
      <a className="inline-flex items-center rounded-md border border-good/40 bg-good/10 px-1.5 text-[0.68rem] font-semibold text-good no-underline hover:bg-good/20" href={row.source} target="_blank" rel="noopener" title="Volume checked; opens the source">
        ✓ verified
      </a>
    ) : <Badge variant="ok">✓ verified</Badge>;
  }
  if (row.status === 'in-progress') return <Badge variant="est" title="The volume for this year is still being published">in progress</Badge>;
  return <Badge variant="tag">not yet verified</Badge>;
}
