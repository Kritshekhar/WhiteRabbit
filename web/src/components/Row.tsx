import type { ReactNode } from 'react';
import { fmtDate, type Band, type Round } from '@/lib/dates';
import type { CalendarEvent } from '@/lib/calendar';
import { CalendarLink } from './CalendarLink';
import { ExternalIcon } from './Icons';
import { Provenance } from './Provenance';
import { buttonVariants } from './ui/button';

export interface RowProps {
  href: string;
  title: string;
  subtitle?: string;
  tags?: ReactNode;
  deadline: Round | null;
  days: number | null;
  band: Band | null;
  statusText: string;
  url?: string;
  calendar?: CalendarEvent | null;
}

/* One record per row. A div, not an anchor: the row holds links of its own
   (verified badge, calendar, official page) and nested anchors are invalid.
   The title stays a real link, so rows are keyboard reachable and
   cmd-clickable; a click anywhere else on the row follows it too. */
export function Row({ href, title, subtitle, tags, deadline, days, band, statusText, url, calendar }: RowProps) {
  const go = (e: React.MouseEvent | React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    if ('metaKey' in e && (e.metaKey || e.ctrlKey)) window.open(href, '_blank', 'noopener');
    else window.location.href = href;
  };
  return (
    <div
      className={`group relative grid cursor-pointer grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-surface-1 py-3 pr-3 pl-5 shadow-sm transition hover:-translate-y-px hover:border-border-strong hover:shadow-card ${
        tags ? 'md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.9fr)_3.5rem_auto]' : 'md:grid-cols-[minmax(0,2.6fr)_minmax(0,2fr)_3.5rem_auto]'
      }`}
      style={{ ['--status' as string]: band ? band.color : 'var(--border-strong)' }}
      onClick={go}
    >
      <span aria-hidden className="absolute inset-y-2 left-1.5 w-1 rounded-full bg-[var(--status)]" />
      <span className="col-span-2 min-w-0 md:col-span-1">
        <a className="block truncate font-bold text-fg no-underline hover:text-accent" href={href}>
          {title}
        </a>
        {subtitle && <span className="block truncate text-[0.8rem] text-muted">{subtitle}</span>}
      </span>
      {tags && <span className="col-span-2 flex min-w-0 flex-wrap gap-1.5 md:col-span-1">{tags}</span>}
      <span className="min-w-0 text-[0.85rem]">
        {deadline && deadline.ts ? (
          <span className="text-fg-2">
            <strong className="text-fg">{deadline.name}</strong>
            {' · '}
            <span className="whitespace-nowrap">
              {fmtDate(deadline.ts, deadline.off)} <Provenance deadline={deadline} />
            </span>
          </span>
        ) : (
          <span className="text-muted">{statusText || 'No date announced'}</span>
        )}
      </span>
      <span className="hidden text-right md:block">
        {days !== null && (
          <span className="font-mono text-lg font-bold tabular" style={{ color: band ? band.color : 'var(--text-muted)' }}>
            {days}
            <small className="text-xs">d</small>
          </span>
        )}
      </span>
      <span className="flex items-center justify-end gap-0.5">
        {days !== null && (
          <span className="mr-2 font-mono text-base font-bold tabular md:hidden" style={{ color: band ? band.color : undefined }}>
            {days}
            <small className="text-xs">d</small>
          </span>
        )}
        {calendar && <CalendarLink event={calendar} />}
        {url && (
          <a
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
            href={url}
            target="_blank"
            rel="noopener"
            title="Open the official page"
            aria-label="Open the official page"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalIcon />
          </a>
        )}
      </span>
    </div>
  );
}
