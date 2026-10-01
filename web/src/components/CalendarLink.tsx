import { googleCalendarUrl, type CalendarEvent } from '@/lib/calendar';
import { CalendarIcon } from './Icons';
import { buttonVariants } from './ui/button';
import { cn } from '@/lib/utils';

export function CalendarLink({ event, label, className }: { event: CalendarEvent; label?: string; className?: string }) {
  const url = googleCalendarUrl(event);
  if (!url) return null;
  return (
    <a
      className={cn(buttonVariants({ variant: label ? 'outline' : 'ghost', size: label ? 'md' : 'icon-sm' }), className)}
      href={url}
      target="_blank"
      rel="noopener"
      title="Add to Google Calendar"
      aria-label={label ? undefined : `Add ${event.title} to Google Calendar`}
      onClick={(e) => e.stopPropagation()}
    >
      <CalendarIcon />
      {label}
    </a>
  );
}
