import { Star } from 'lucide-react';
import { buildCalendar, downloadIcs, entryIcsEvents } from '@/lib/ics';
import { href } from '@/lib/utils';
import { useWatchlist } from '@/lib/watchlist';
import UpcomingDeadlines, { type UpcomingEntry } from './UpcomingDeadlines';

/* The home page's "Your deadlines": the next deadlines of whatever the visitor
   starred. Renders nothing until something is starred, and nothing on the
   server, since the list lives only in this browser. */
export default function YourDeadlines({ entries, builtAt }: { entries: UpcomingEntry[]; builtAt: string }) {
  const watched = useWatchlist();
  if (!watched.length) return null;
  const mine = entries.filter((e) => e.key && watched.includes(e.key));

  return (
    <section className="mt-14 space-y-4" aria-labelledby="mine-h">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="wr-eyebrow flex items-center gap-1.5"><Star className="size-3.5" fill="currentColor" aria-hidden="true" /> My venues</p>
          <h2 id="mine-h" className="text-2xl font-bold tracking-tight">Your deadlines</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            className="cursor-pointer font-semibold text-accent hover:underline"
            onClick={() => downloadIcs('my-venues.ics', buildCalendar('White Rabbit: my venues',
              'Deadlines of everything you starred on White Rabbit.', mine.flatMap((e) => entryIcsEvents(e))))}
          >
            Download as .ics
          </button>
          <a className="font-semibold text-accent hover:underline" href={href('conferences/')}>Star more venues</a>
        </div>
      </div>
      <UpcomingDeadlines entries={mine} builtAt={builtAt} limit={12} />
      <p className="text-xs text-muted">
        {watched.length} starred · saved in this browser only, nothing is sent anywhere.
      </p>
    </section>
  );
}
