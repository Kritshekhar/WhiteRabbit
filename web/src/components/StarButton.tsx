import { Star } from 'lucide-react';
import { toggleWatch, useWatchlist } from '@/lib/watchlist';
import { cn } from '@/lib/utils';
import { buttonVariants } from './ui/button';

/* Star a venue or grant. Icon-only in list rows, labelled on detail pages. */
export function StarButton({ watchKey, name, labelled = false, className }: {
  watchKey: string;
  name: string;
  labelled?: boolean;
  className?: string;
}) {
  const on = useWatchlist().includes(watchKey);
  return (
    <button
      type="button"
      aria-pressed={on}
      title={on ? `Remove ${name} from My venues` : `Add ${name} to My venues`}
      aria-label={labelled ? undefined : on ? `Unstar ${name}` : `Star ${name}`}
      onClick={(e) => { e.stopPropagation(); toggleWatch(watchKey); }}
      className={cn(
        buttonVariants({ variant: labelled ? 'outline' : 'ghost', size: labelled ? 'md' : 'icon-sm' }),
        'cursor-pointer',
        on && 'text-warning',
        className,
      )}
    >
      <Star className="size-4" fill={on ? 'currentColor' : 'none'} aria-hidden="true" />
      {labelled && (on ? 'Starred' : 'Star')}
    </button>
  );
}
