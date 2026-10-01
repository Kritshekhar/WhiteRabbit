import { useState } from 'react';
import type { Who } from '@/lib/who';

const SECTOR: Record<string, string> = { education: 'var(--rank-base)', company: 'var(--rank-mid)' };
const flag = (code: string) =>
  /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '';

/* Who publishes most, across all venues or within one research area. */
export default function WhoOverview({ areas }: { areas: { slug: string; label: string; who: Who }[] }) {
  const [slug, setSlug] = useState(areas[0]?.slug ?? 'all');
  const cur = areas.find((a) => a.slug === slug) ?? areas[0];
  if (!cur) return null;
  const maxI = Math.max(1, ...cur.who.institutions.map((i) => i.papers));
  const maxC = Math.max(1, ...cur.who.countries.map((c) => c.papers));
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Research area">
        {areas.map((a) => (
          <button key={a.slug} type="button" onClick={() => setSlug(a.slug)} aria-pressed={a.slug === slug}
            className="h-7 cursor-pointer rounded-full border border-border px-2.5 text-[0.78rem] font-semibold text-fg-2 hover:border-border-strong aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent">
            {a.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        {cur.who.from}–{cur.who.to} · academia <strong className="text-fg-2">{pct(cur.who.split.academia)}</strong>,
        industry <strong className="text-fg-2">{pct(cur.who.split.industry)}</strong> of papers among the top institutions
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ol className="card space-y-1.5 p-4">
          {cur.who.institutions.map((i, n) => (
            <li key={i.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2 text-sm">
              <span className="font-mono text-xs text-muted tabular">{n + 1}</span>
              <span className="min-w-0">
                <span className="flex items-baseline gap-1.5">
                  <span className="truncate font-semibold" title={i.name}>{i.name}</span>
                  <span className="shrink-0 text-xs" aria-label={i.country}>{flag(i.country)}</span>
                </span>
                <span className="mt-0.5 block h-1.5 rounded-full bg-surface-2">
                  <span className="block h-full rounded-full" style={{ width: `${(i.papers / maxI) * 100}%`, background: SECTOR[i.type] ?? 'var(--rank-off)' }} />
                </span>
              </span>
              <span className="font-mono text-xs font-semibold tabular">{i.papers.toLocaleString()}</span>
            </li>
          ))}
        </ol>
        <ol className="card space-y-1.5 p-4">
          {cur.who.countries.map((c) => (
            <li key={c.code} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-2 text-sm">
              <span aria-hidden>{flag(c.code)}</span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{c.name}</span>
                <span className="mt-0.5 block h-1.5 rounded-full bg-surface-2">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${(c.papers / maxC) * 100}%` }} />
                </span>
              </span>
              <span className="font-mono text-xs font-semibold tabular">{c.papers.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
