import { useEffect, useMemo, useState } from 'react';
import { decorate, fmtDate, isAoE } from '@/lib/dates';
import { eventDetails, googleCalendarUrl } from '@/lib/calendar';
import { GRANT_BANDS, VENUE_BANDS } from '@/lib/tiers';
import type { UpcomingEntry } from '../islands/UpcomingDeadlines';
import { Provenance } from '../Provenance';
import { ArrowIcon, CalendarIcon } from '../Icons';
import { useWatchlist } from '@/lib/watchlist';

/* The hero's signature element: the very next deadline, counting down to the
   second. The first render uses the build time so server HTML and hydration
   agree; then the real clock takes over and ticks every second. */

const pad = (n: number) => String(n).padStart(2, '0');

function useTick(builtAt: string): number {
  const [now, setNow] = useState(() => Date.parse(builtAt));
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/* One unit of the clock. Each digit is keyed by its value, so a change
   remounts it and the CSS roll-in plays once; reduced motion turns that off. */
function Unit({ value, label, width = 2 }: { value: number; label: string; width?: number }) {
  const text = String(value).padStart(width, '0');
  return (
    <div className="flex flex-col items-center">
      <div className="wr-clock-cell flex overflow-hidden rounded-xl border border-border bg-surface-2 px-2 py-1.5 sm:px-3 sm:py-2">
        {text.split('').map((d, i) => (
          <span key={`${i}-${d}`} className="wr-digit inline-block w-[0.62em] text-center font-mono text-3xl font-bold tabular sm:text-[2.6rem]">
            {d}
          </span>
        ))}
      </div>
      <span className="mt-1.5 text-[0.65rem] font-semibold tracking-[0.14em] text-muted uppercase">{label}</span>
    </div>
  );
}

export default function NextCountdown({ entries, builtAt }: { entries: UpcomingEntry[]; builtAt: string }) {
  const now = useTick(builtAt);
  /* re-rank only when a deadline actually passes, not on every tick */
  const minute = Math.floor(now / 60000);
  /* starred venues first: once someone follows venues, the hero counts down
     to their next deadline rather than the world's */
  const watched = useWatchlist();
  const { queue, mine } = useMemo(() => {
    const rank = (list: UpcomingEntry[]) =>
      list
        .map((e) => decorate(e, minute * 60000, e.kind === 'conference' ? VENUE_BANDS : GRANT_BANDS))
        .filter((e) => e.next && e.next.ts)
        .sort((a, b) => (a.next!.ts as number) - (b.next!.ts as number))
        .slice(0, 3);
    const starred = rank(entries.filter((e) => e.key && watched.includes(e.key)));
    return starred.length ? { queue: starred, mine: true } : { queue: rank(entries), mine: false };
  }, [entries, minute, watched]);

  const head = queue[0];
  if (!head) {
    return <div className="card p-6 text-muted">Nothing scheduled right now.</div>;
  }
  const r = head.next!;
  const left = Math.max(0, (r.ts as number) - now);
  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const cal = googleCalendarUrl({
    title: `${head.name} - ${r.name}`,
    iso: r.date as string,
    details: eventDetails([head.sub || head.name, '', `${r.name} deadline${r.confirmed ? '' : ' (estimated)'}.`,
      head.url ? `Official page: ${head.url}` : '']),
    location: head.url,
  });

  return (
    <div className="wr-hero-card card relative overflow-hidden p-5 sm:p-6">
      <div aria-hidden className="wr-hero-card-sheen" />
      <div className="relative flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-[0.7rem] font-semibold tracking-[0.14em] text-muted uppercase">
          <span className="wr-live-dot" aria-hidden /> {mine ? 'Your next deadline' : 'Next deadline'}
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 text-[0.68rem] font-semibold text-fg-2 uppercase">{head.kind}</span>
      </div>

      <a href={head.href} className="relative mt-3 block no-underline">
        <span className="block truncate text-xl font-bold text-fg hover:text-accent sm:text-2xl">{head.name}</span>
        {head.sub && <span className="block truncate text-sm text-fg-2">{head.sub}</span>}
      </a>

      <div
        className="relative mt-5 flex items-start justify-between gap-1.5 sm:gap-2.5"
        role="timer"
        aria-live="off"
        aria-label={`${d} days, ${h} hours, ${m} minutes left`}
      >
        <Unit value={d} label="days" width={d >= 100 ? 3 : 2} />
        <span className="pt-3 font-mono text-2xl font-bold text-muted sm:pt-4" aria-hidden>:</span>
        <Unit value={h} label="hours" />
        <span className="pt-3 font-mono text-2xl font-bold text-muted sm:pt-4" aria-hidden>:</span>
        <Unit value={m} label="min" />
        <span className="pt-3 font-mono text-2xl font-bold text-muted sm:pt-4" aria-hidden>:</span>
        <Unit value={s} label="sec" />
      </div>

      <div className="relative mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <span className="text-sm text-fg-2">
          {r.name} · {fmtDate(r.ts as number, r.off)}
          {isAoE(r.date) && <span className="ml-1 text-xs text-muted">AoE</span>} <Provenance deadline={r} />
        </span>
        {cal && (
          <a
            href={cal}
            target="_blank"
            rel="noopener"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-xs font-semibold text-fg no-underline transition hover:border-border-strong hover:bg-surface-2"
          >
            <CalendarIcon className="size-3.5" /> Add to calendar
          </a>
        )}
      </div>

      {queue.length > 1 && (
        <ol className="relative mt-4 space-y-1.5" aria-label="Then">
          {queue.slice(1).map((e) => (
            <li key={e.href + e.next!.name}>
              <a
                href={e.href}
                className="group flex items-center gap-3 rounded-xl border border-border bg-surface-0/40 px-3 py-2 no-underline transition hover:border-border-strong"
              >
                <span className="w-12 shrink-0 font-mono text-sm font-bold tabular" style={{ color: e.band?.color }}>
                  {e.days}d
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg group-hover:text-accent">{e.name}</span>
                <span className="hidden shrink-0 text-xs text-muted sm:inline">{e.next!.name}</span>
                <ArrowIcon className="size-3.5 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-accent" />
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
