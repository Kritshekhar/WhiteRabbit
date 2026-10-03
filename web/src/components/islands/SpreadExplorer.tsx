import { useEffect, useMemo, useState } from 'react';
import type { SpreadFile } from '@/lib/insights';
import { href } from '@/lib/utils';

/* Where an idea spread: for one phrase, the share of each venue's titles that
   use it, year by year. Venues are ordered by the year the phrase first passed
   1% of their titles, so the diffusion reads top to bottom.

   Other parts of the page pick a phrase by dispatching `wr:term` on window. */

const THRESHOLD = 0.01;
const MAX_ROWS = 25;
const pct = (s: number) => `${(s * 100).toFixed(s < 0.01 ? 2 : 1)}%`;

export default function SpreadExplorer({ url }: { url: string }) {
  const [data, setData] = useState<SpreadFile | null>(null);
  const [failed, setFailed] = useState(false);
  const [term, setTerm] = useState('');

  useEffect(() => {
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: SpreadFile) => {
        setData(d);
        const wanted = new URLSearchParams(window.location.search).get('term');
        setTerm((t) => t || (wanted && d.terms[wanted] ? wanted : d.terms.llms ? 'llms' : d.suggested[0] || Object.keys(d.terms)[0] || ''));
      })
      .catch(() => setFailed(true));
  }, [url]);

  useEffect(() => {
    const pick = (e: Event) => setTerm((e as CustomEvent<string>).detail);
    window.addEventListener('wr:term', pick);
    return () => window.removeEventListener('wr:term', pick);
  }, []);

  const allTerms = useMemo(() => (data ? Object.keys(data.terms).sort() : []), [data]);

  const rows = useMemo(() => {
    if (!data || !data.terms[term]) return [];
    return data.terms[term]
      .map(([vi, counts]) => {
        const shares = counts.map((c, yi) => (data.papers[vi][yi] ? c / data.papers[vi][yi] : null));
        const firstYi = shares.findIndex((s) => s !== null && s >= THRESHOLD);
        const peak = Math.max(...shares.map((s) => s ?? 0));
        return { id: data.venues[vi][0], name: data.venues[vi][1], shares, counts, first: firstYi >= 0 ? data.years[firstYi] : null, peak };
      })
      .filter((r) => r.peak > 0)
      .sort((a, b) => (a.first ?? 9999) - (b.first ?? 9999) || b.peak - a.peak)
      .slice(0, MAX_ROWS);
  }, [data, term]);

  const max = Math.max(0.0001, ...rows.flatMap((r) => r.shares.map((s) => s ?? 0)));
  const passed = rows.filter((r) => r.first !== null);

  if (failed) return <p className="text-sm text-muted">The spread data could not be loaded.</p>;
  if (!data) return <p className="text-sm text-muted">Loading...</p>;
  if (!allTerms.length) return <p className="text-sm text-muted">Phrase data is still being mined.</p>;

  // a venue already above 1% in the first year shown did not "pass" it then
  const start = data.years[0];
  const already = passed.filter((r) => r.first === start);
  const later = passed.filter((r) => r.first !== start);
  const parts: string[] = [];
  if (already.length) {
    parts.push(`"${term}" was already above 1% of titles at ${already.length === 1 ? already[0].name : `${already.length} venues`} in ${start}`);
  }
  if (later.length) {
    const head = later[0];
    const tail = later[later.length - 1];
    parts.push(later.length === 1
      ? `${already.length ? 'it' : `"${term}"`} first passed 1% at ${head.name} in ${head.first}`
      : `${already.length ? 'it' : `"${term}"`} first passed 1% at ${head.name} in ${head.first}, and most recently at ${tail.name} in ${tail.first}`);
  }
  const sentence = parts.length
    ? `${parts.join('; ')}.`
    : `"${term}" has not reached 1% of titles at any tracked venue since ${start}.`;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Suggested phrases">
          {data.suggested.map((t) => (
            <button key={t} type="button" onClick={() => setTerm(t)} aria-pressed={t === term}
              className="h-7 cursor-pointer rounded-full border border-border bg-surface-2 px-2.5 text-[0.78rem] font-semibold text-fg-2 hover:border-border-strong aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent">
              {t}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="shrink-0 font-semibold text-fg-2">Any phrase</span>
          <select value={term} onChange={(e) => setTerm(e.target.value)}
            className="h-8 max-w-[14rem] min-w-0 cursor-pointer rounded-full border border-border bg-surface-1 px-3 text-[0.8rem] font-semibold">
            {allTerms.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      <p className="text-sm text-fg-2" aria-live="polite">{sentence}</p>

      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-surface-1 px-2 py-1.5 text-left font-semibold text-muted">Venue</th>
                {data.years.map((y, i) => (
                  <th key={y} scope="col" className="px-0.5 py-1.5 text-center font-mono font-normal text-muted tabular">
                    {i % 2 === 0 || i === data.years.length - 1 ? `'${String(y).slice(2)}` : ''}
                  </th>
                ))}
                <th scope="col" className="px-2 py-1.5 text-right font-semibold text-muted">First 1%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="sticky left-0 z-10 max-w-[9rem] truncate bg-surface-1 px-2 py-0.5 text-left font-semibold">
                    <a className="text-fg no-underline hover:text-accent" href={href(`proceedings/${encodeURIComponent(r.id)}/`)}>{r.name}</a>
                  </th>
                  {r.shares.map((s, i) => {
                    const t = s === null ? 0 : Math.sqrt(s / max);
                    return (
                      <td key={data.years[i]} className="p-0.5">
                        <span
                          className="block h-5 min-w-5 rounded-[3px]"
                          style={{
                            background: s === null
                              ? 'transparent'
                              : `color-mix(in oklab, var(--accent) ${Math.round(14 + t * 86)}%, var(--surface-2))`,
                            outline: s === null ? '1px dashed var(--border)' : undefined,
                            outlineOffset: -1,
                          }}
                          title={s === null
                            ? `${r.name} ${data.years[i]}: no papers indexed`
                            : `${r.name} ${data.years[i]}: ${r.counts[i]} of ${data.papers[data.venues.findIndex((v) => v[0] === r.id)][i]} titles (${pct(s)})`}
                        />
                      </td>
                    );
                  })}
                  <td className="px-2 text-right font-mono text-muted tabular">{r.first ?? 'not yet'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">No tracked venue used this phrase since {data.years[0]}.</p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>0%</span>
        <span className="h-2.5 w-32 rounded-full" style={{ background: 'linear-gradient(90deg, color-mix(in oklab, var(--accent) 14%, var(--surface-2)), var(--accent))' }} />
        <span>{pct(max)} of a venue's titles</span>
        <span className="ml-2 inline-block size-3 rounded-[3px] outline-1 outline-dashed outline-border" /> no papers indexed that year
      </div>
    </div>
  );
}
