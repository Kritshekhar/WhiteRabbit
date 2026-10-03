import { decorate, fmtDate } from '@/lib/dates';
import { GRANT_BANDS, VENUE_BANDS } from '@/lib/labels';
import type { Deadline } from '@/lib/types';
import { Provenance } from '../Provenance';
import { useNow } from '../useNow';

export interface UpcomingEntry {
  kind: 'conference' | 'funding';
  name: string;
  sub: string;
  href: string;
  deadlines: Deadline[];
  /* official page, for calendar events */
  url?: string;
  /* My venues key: "venue:<id>" or "grant:<id>" */
  key?: string;
}

/* How full the urgency bar is: a deadline 60 days out is an empty bar, one
   due today a full one. */
const HORIZON_DAYS = 60;

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
    <ol className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {next.map((e, i) => {
        const fill = Math.max(0.04, Math.min(1, 1 - (e.days ?? HORIZON_DAYS) / HORIZON_DAYS));
        return (
          <li key={e.href} style={{ ['--i' as string]: i }}>
            <a
              href={e.href}
              className="card wr-lift group relative flex h-full items-center gap-4 overflow-hidden p-4 no-underline"
            >
              <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: e.band?.color }} />
              <span className="w-14 shrink-0 text-center">
                <span className="block font-mono text-2xl font-bold tabular" style={{ color: e.band?.color }}>{e.days}</span>
                <span className="block text-[0.68rem] font-semibold text-muted uppercase">{e.days === 1 ? 'day' : 'days'}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.68rem] font-semibold tracking-wide text-muted uppercase">{e.kind}</span>
                <span className="block truncate font-bold text-fg group-hover:text-accent">{e.name}</span>
                <span className="block truncate text-xs text-fg-2">
                  {e.next!.name} · {fmtDate(e.next!.ts as number, e.next!.off)} <Provenance deadline={e.next} plain />
                </span>
              </span>
              <span
                aria-hidden
                className="wr-urgency absolute inset-x-0 bottom-0 h-[3px] origin-left"
                style={{ background: e.band?.color, transform: `scaleX(${fill})` }}
                title={e.band?.label}
              />
            </a>
          </li>
        );
      })}
    </ol>
  );
}
