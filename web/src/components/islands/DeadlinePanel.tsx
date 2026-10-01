import { decorate, fmtDate, isAoE } from '@/lib/dates';
import { grantEvent, venueEvent, type CalendarEvent } from '@/lib/calendar';
import { GRANT_BANDS, VENUE_BANDS } from '@/lib/tiers';
import type { Grant, Venue } from '@/lib/types';
import { CalendarLink } from '../CalendarLink';
import { SubscribeMenu } from '../SubscribeMenu';
import { Provenance } from '../Provenance';
import { Badge } from '../ui/badge';
import { useNow } from '../useNow';

type Props =
  | { kind: 'venue'; record: Venue; builtAt: string }
  | { kind: 'grant'; record: Grant; builtAt: string };

/* The time-dependent part of a detail page: countdown hero and the rounds
   table, recomputed against the viewer's clock on load. */
export default function DeadlinePanel(props: Props) {
  const now = useNow(props.builtAt);
  const isVenue = props.kind === 'venue';
  const v = decorate(props.record as Venue | Grant, now, isVenue ? VENUE_BANDS : GRANT_BANDS);
  const event = (r: NonNullable<typeof v.next>): CalendarEvent =>
    isVenue ? venueEvent(props.record as Venue, r) : grantEvent(props.record as Grant, r);
  const rolling = isVenue && (props.record as Venue).rolling;
  // a subscription keeps following this venue's next cycles too
  const feed = `${isVenue ? 'conferences' : 'grants'}/${props.record.id}.ics`;
  const dated = v.rounds.filter((r) => r.ts);

  return (
    <div className="space-y-6">
      <div
        className="card relative overflow-hidden p-5 sm:p-6"
        style={{ ['--status' as string]: v.band ? v.band.color : 'var(--border-strong)' }}
      >
        <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-[var(--status)]" />
        {v.next && v.next.ts ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-5xl font-bold tracking-tight tabular" style={{ color: v.band?.color }}>
                {v.days}
              </span>
              <span className="text-sm font-semibold text-fg-2">{v.days === 1 ? 'day left' : 'days left'}</span>
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-[0.95rem]">
                <strong>{v.next.name}</strong> · {fmtDate(v.next.ts, v.next.off)} <Provenance deadline={v.next} />
              </p>
              <p className="text-sm text-muted">
                {v.band?.label}
                {isAoE(v.next.date) ? ' · deadline is AoE (UTC-12)' : ''}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <CalendarLink event={event(v.next)} label="Add to Google Calendar" />
              <SubscribeMenu feed={feed} name={`White Rabbit: ${props.record.name}`} label="Subscribe" />
            </div>
          </div>
        ) : (
          <p className="text-lg font-semibold text-fg-2">
            {rolling
              ? 'Rolling submission, no deadline'
              : v.hasDates
                ? 'Cycle closed, awaiting the next call'
                : 'Deadline not announced'}
          </p>
        )}
      </div>

      {dated.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">All deadlines</h2>
          <div className="card divide-y divide-border overflow-hidden">
            {dated.map((r, i) => {
              const past = (r.ts as number) < now;
              return (
                <div key={i} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 ${past ? 'opacity-55' : ''}`}>
                  <span className="min-w-0">
                    {r.track && <Badge variant="track" className="mr-1.5">{r.track}</Badge>}
                    <span className={past ? 'line-through decoration-1' : 'font-medium'}>{r.name}</span>
                  </span>
                  <span className="flex items-center gap-2 text-sm whitespace-nowrap">
                    <span className="tabular">{fmtDate(r.ts as number, r.off)}</span>
                    <Provenance deadline={r} />
                    {!past && <CalendarLink event={event(r)} />}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
