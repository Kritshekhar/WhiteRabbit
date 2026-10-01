import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TermCount } from '@/lib/types';
import { Badge } from '../ui/badge';
import { Panel } from '../Panel';
import TopicExplorer from '../TopicExplorer';

export interface VolumeLink {
  title: string;      // the volume's own title, from DBLP
  publisher: string;  // the publisher's page (ACM DL, USENIX, PMLR, OpenReview, ...)
  dblp: string;       // DBLP's table of contents
}

export interface YearRow {
  year: number;
  count: number | null;
  rate: number | null;
  status: 'verified' | 'in-progress' | 'unverified';
  source: string;
  links: VolumeLink[];
  submitted?: number | null;         // official figures, from rateSource
  acceptedOfficial?: number | null;
  rateSource?: string;
  rateKind?: 'official' | 'reported';
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
      // a gap, not a zero: the phrase was just outside that year's top 30
      out.push({ year: y, count: hit ? hit[1] : null });
    }
    return out;
  }, [kw, term, counted]);

  const selected = rows.find((r) => r.year === year) ?? null;

  return (
    <div className="space-y-6">
      <Panel
        title="Papers in main proceedings (DBLP)"
        note="Counts papers published in the venue's main DBLP volume each year. This is not an official acceptance count: it can include short papers and exclude workshop or companion volumes."
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={counted}
            margin={{ left: -12, right: 8 }}
            onClick={(state) => { const y = Number(state?.activeLabel); if (y) setYear(y); }}
            className="cursor-pointer"
          >
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="year" tick={axis} stroke="var(--border)" minTickGap={16} />
            <YAxis tick={axis} stroke="var(--border)" allowDecimals={false} />
            <Tooltip {...tooltip} formatter={(v) => [v, 'papers']} />
            <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {counted.map((r) => (
                <Cell key={r.year} fill={statusColor[r.status]} fillOpacity={year === null || r.year === year ? 1 : 0.45} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span><span className="mr-1 inline-block size-2.5 rounded-sm bg-accent align-middle" />verified volume</span>
          <span><span className="mr-1 inline-block size-2.5 rounded-sm bg-warning align-middle" />in progress</span>
          <span><span className="mr-1 inline-block size-2.5 rounded-sm bg-border-strong align-middle" />not yet verified</span>
          <span className="ml-auto">Click a bar to open that year.</span>
        </p>
        {selected && <SelectedYear row={selected} />}
      </Panel>

      {rates.length > 0 && (
        <Panel title="Acceptance rate" note="Accepted papers as a share of submissions. Unmarked figures come from the venue itself (the program chairs\u2019 message); figures marked \u2020 are reported figures. Hover a year in the table for the counts; click for the source.">
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
                <span className="text-xs text-muted">Gaps are years where it was not among the top 30 phrases.</span>
                <datalist id="kw-terms">{allTerms.slice(0, 500).map((t) => <option key={t} value={t} />)}</datalist>
              </label>
              {trend.length > 0 && (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trend} margin={{ left: -12, right: 8, top: 12 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="year" tick={axis} stroke="var(--border)" minTickGap={16} />
                    <YAxis tick={axis} stroke="var(--border)" allowDecimals={false} />
                    <Tooltip {...tooltip} formatter={(v) => [v, `titles with "${term}"`]} />
                    <Line dataKey="count" stroke="var(--rank-base)" strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </Panel>

      {topics.length > 0 && (
        <Panel
          title="Topics"
          note="OpenAlex research topics of each year's papers. Share is of all topic tags that year, so small and large years compare fairly. Click a topic to see its trend."
        >
          <TopicExplorer topics={topics} year={year} onYear={setYear} />
        </Panel>
      )}

      <Panel title="Year by year">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs text-muted uppercase">
              <tr><th className="py-1.5 pr-4">Year</th><th className="py-1.5 pr-4 text-right">Papers (DBLP)</th>{rates.length > 0 && <th className="py-1.5 pr-4 text-right">Acceptance</th>}<th className="py-1.5 pr-4">Status</th><th className="py-1.5">Read the proceedings</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...rows].reverse().map((r) => (
                <tr key={r.year} className={r.year === year ? 'bg-accent-soft/60' : undefined}>
                  <td className="py-1.5 pr-4 font-semibold tabular">
                    <button type="button" className="cursor-pointer hover:text-accent" onClick={() => setYear(r.year)}>{r.year}</button>
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular">{r.count?.toLocaleString() ?? 'n/a'}</td>
                  {rates.length > 0 && (
                    <td className="py-1.5 pr-4 text-right tabular">
                      {r.rate !== null && (
                        <a href={r.rateSource} target="_blank" rel="noopener" className="text-fg no-underline hover:text-accent"
                          title={`${r.acceptedOfficial ? `${r.acceptedOfficial} accepted, ` : ''}${r.submitted ? `${r.submitted} submitted, ` : ''}${r.rateKind === 'reported' ? 'reported figure' : "from the program chairs' message"}`}>
                          {(r.rate * 100).toFixed(1)}%{r.rateKind === 'reported' && <sup className="text-muted">†</sup>}
                          {r.submitted ? <span className="ml-1 text-xs text-muted">({r.acceptedOfficial ? `${r.acceptedOfficial}/${r.submitted}` : `${r.submitted} submitted`})</span> : null}
                        </a>
                      )}
                    </td>
                  )}
                  <td className="py-1.5 pr-4"><YearBadge row={r} /></td>
                  <td className="py-1.5"><VolumeLinks links={r.links} compact /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/* The chosen year: its count, status and where to read it. */
function SelectedYear({ row }: { row: YearRow }) {
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-surface-0 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm">
          <span className="text-lg font-bold tabular">{row.year}</span>
          <span className="font-mono text-fg-2 tabular">{row.count?.toLocaleString() ?? 'n/a'} papers</span>
          <YearBadge row={row} />
        </p>
        {row.links[0]?.title && <p className="mt-1 line-clamp-2 text-xs text-muted">{row.links[0].title}</p>}
      </div>
      <VolumeLinks links={row.links} />
    </div>
  );
}

/* Links to a year's volume(s): the publisher's page first, DBLP's contents second. */
function VolumeLinks({ links, compact = false }: { links: VolumeLink[]; compact?: boolean }) {
  if (!links.length) return <span className="text-xs text-muted">n/a</span>;
  const many = links.length > 1;
  return (
    <span className={compact ? 'flex flex-wrap gap-x-3 gap-y-1' : 'flex shrink-0 flex-wrap gap-2'}>
      {links.map((l, i) => (
        <span key={l.dblp} className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          {l.publisher && (
            <a
              href={l.publisher}
              target="_blank"
              rel="noopener"
              title={l.title || 'The proceedings on the publisher site'}
              className={compact
                ? 'text-xs font-semibold text-accent no-underline hover:underline'
                : 'inline-flex h-9 items-center rounded-xl bg-accent px-3.5 text-sm font-semibold text-white no-underline hover:brightness-110'}
            >
              {many ? `Volume ${i + 1}` : 'Proceedings'} ↗
            </a>
          )}
          <a
            href={l.dblp}
            target="_blank"
            rel="noopener"
            title="Table of contents on DBLP"
            className={compact
              ? 'text-xs font-semibold text-fg-2 no-underline hover:text-accent hover:underline'
              : 'inline-flex h-9 items-center rounded-xl border border-border px-3.5 text-sm font-semibold text-fg no-underline hover:border-border-strong'}
          >
            {many && !l.publisher ? `Volume ${i + 1} on DBLP` : 'DBLP'} ↗
          </a>
        </span>
      ))}
    </span>
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
