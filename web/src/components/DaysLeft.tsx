import { useEffect, useState } from 'react';
import type { Band } from '@/lib/dates';

/* Time left on a row, ticking every second: "42d 14:05:33". A past or
   undated deadline shows the plain day count.

   One shared one-second timer drives every ticking row on the page, and the
   first render shows the plain day count so server HTML and hydration agree. */

const subscribers = new Set<(t: number) => void>();
let timer: number | undefined;

function useSecondTick(enabled: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    subscribers.add(setNow);
    setNow(Date.now());
    if (timer === undefined) {
      timer = window.setInterval(() => {
        const t = Date.now();
        subscribers.forEach((fn) => fn(t));
      }, 1000);
    }
    return () => {
      subscribers.delete(setNow);
      if (!subscribers.size && timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
  }, [enabled]);
  return now;
}

const two = (n: number) => String(n).padStart(2, '0');

export function DaysLeft({ ts, days, band, size = 'lg' }: {
  ts: number | null | undefined; days: number; band: Band | null; size?: 'lg' | 'base';
}) {
  const live = !!ts && ts - Date.now() > 0;
  const now = useSecondTick(live);
  const color = band ? band.color : 'var(--text-muted)';
  const text = size === 'lg' ? 'text-lg' : 'text-base';

  if (live && now !== null && ts) {
    const left = Math.max(0, ts - now);
    const d = Math.floor(left / 86400000);
    const h = Math.floor((left % 86400000) / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    const s = Math.floor((left % 60000) / 1000);
    return (
      <span className={`inline-flex items-baseline gap-1 font-mono font-bold whitespace-nowrap tabular ${text}`} style={{ color }}
        title="Time left until the deadline" aria-label={`${d} days ${h} hours ${m} minutes left`}>
        {d > 0 && <span>{d}<small className="text-xs">d</small></span>}
        <span className="text-[0.8em] opacity-90">{two(h)}:{two(m)}<span className="opacity-60">:{two(s)}</span></span>
      </span>
    );
  }
  return (
    <span className={`font-mono font-bold tabular ${text}`} style={{ color }}>
      {days}
      <small className="text-xs">d</small>
    </span>
  );
}
