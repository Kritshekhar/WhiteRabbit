import { decorate, fmtDate } from '@/lib/dates';
import { GRANT_BANDS, VENUE_BANDS } from '@/lib/tiers';
import type { Deadline } from '@/lib/types';
import { Provenance } from '../Provenance';
import { useNow } from '../useNow';

export interface UpcomingEntry {
  kind: 'conference' | 'funding';
  name: string;
  sub: string;
  href: string;
  deadlines: Deadline[];
}

/* The next few deadlines across conferences and funding, by days left. */
export default function UpcomingDeadlines({ entries, builtAt, limit = 6 }: { entries: UpcomingEntry[]; builtAt: string; limit?: number }) {
  const now = useNow(builtAt);
  const next = entries
    .map((e) => decorate(e, now, e.kind === 'conference' ? VENUE_BANDS : GRANT_BANDS))
    .filter((e) => e.next)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
    .slice(0, limit);

  if (!next.length) return <p className="card p-6 text-muted">Nothing scheduled right now.</p>;
  return (
    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {next.map((e) => (
        <li key={e.href}>
          <a
            href={e.href}
            className="card group relative flex h-full items-center gap-4 overflow-hidden p-4 no-underline transition hover:-translate-y-px hover:border-border-strong"
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: e.band?.color }} />
            <span className="w-14 shrink-0 text-center">
              <span className="block font-mono text-2xl font-bold tabular" style={{ color: e.band?.color }}>{e.days}</span>
              <span className="block text-[0.68rem] font-semibold text-muted uppercase">days</span>
            </span>
            <span className="min-w-0">
              <span className="block text-[0.68rem] font-semibold tracking-wide text-muted uppercase">{e.kind}</span>
              <span className="block truncate font-bold text-fg group-hover:text-accent">{e.name}</span>
              <span className="block truncate text-xs text-fg-2">
                {e.next!.name} · {fmtDate(e.next!.ts as number, e.next!.off)} <Provenance deadline={e.next} plain />
              </span>
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}
