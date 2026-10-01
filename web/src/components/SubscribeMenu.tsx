import { useState } from 'react';
import { CalendarSync, Check, Copy, Download } from 'lucide-react';
import { HOME } from '@/lib/calendar';
import { href } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { buttonVariants } from './ui/button';
import { cn } from '@/lib/utils';

/* Subscribe to a calendar feed. A subscription is fetched by the calendar
   app itself, so the links always point at the published site: the feed has
   to be reachable from Google's servers, not just from this browser. */
export function SubscribeMenu({ feed, name, label = 'Subscribe', className, size = 'md' }: {
  feed: string;            // path under the site root, e.g. 'calendar/systems.ics'
  name: string;            // shown by calendar apps that take a name
  label?: string;
  className?: string;
  size?: 'md' | 'sm';
}) {
  const https = HOME + feed;
  const webcal = https.replace(/^https:/, 'webcal:');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(https);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt('Copy this calendar address', https);
    }
  };

  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-fg no-underline hover:bg-surface-2';
  return (
    <Popover>
      <PopoverTrigger
        className={cn(buttonVariants({ variant: 'outline', size }), 'cursor-pointer', className)}
        onClick={(e) => e.stopPropagation()}
      >
        <CalendarSync className="size-4" aria-hidden="true" />
        {label}
      </PopoverTrigger>
      <PopoverContent className="w-80" onClick={(e) => e.stopPropagation()}>
        <p className="px-2.5 pt-1 pb-2 text-xs text-muted">
          Your calendar keeps this up to date: new, verified and corrected dates appear on their own.
        </p>
        <a className={item} href={webcal}>Apple Calendar or Outlook desktop</a>
        <a className={item} href={`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noopener">
          Google Calendar
        </a>
        <a className={item} target="_blank" rel="noopener"
          href={`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(name)}`}>
          Outlook.com
        </a>
        <div className="my-1 border-t border-border" />
        <button type="button" className={cn(item, 'cursor-pointer')} onClick={copy}>
          {copied ? <Check className="size-4 text-good" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy calendar address'}
        </button>
        <a className={item} href={href(feed)} download>
          <Download className="size-4" aria-hidden="true" />
          Download .ics (a one-off copy)
        </a>
      </PopoverContent>
    </Popover>
  );
}
